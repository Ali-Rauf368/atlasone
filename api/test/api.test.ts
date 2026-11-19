import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";

const token = (roles: string[]) => jwt.sign({ uid: "t", name: "T", email: "t@x", roles }, process.env.JWT_SECRET!, { jwtid: "test-jti" });

describe("HTTP auth + RBAC (no DB needed)", () => {
  it("health is public", async () => { await request(app).get("/health").expect(200, { ok: true }); });
  it("rejects missing token", async () => { await request(app).get("/api/dashboard/global").expect(401); });
  it("rejects forged token", async () => {
    await request(app).get("/api/dashboard/global").set("Authorization", `Bearer ${jwt.sign({ roles: ["GLOBAL_CEO"] }, "wrong")}`).expect(401);
  });
  it("forbids employees from the CEO dashboard", async () => {
    await request(app).get("/api/dashboard/global").set("Authorization", `Bearer ${token(["EMPLOYEE"])}`).expect(403);
  });
  it("forbids managers from payroll", async () => {
    await request(app).get("/api/hr/payroll").set("Authorization", `Bearer ${token(["DEPARTMENT_MANAGER"])}`).expect(403);
  });
  it("requires the NiFi API key for ingest", async () => {
    await request(app).post("/api/ingest/financials").send([]).expect(401);
  });
});

describe("hardening", () => {
  it("serves the OpenAPI spec", async () => {
    const r = await request(app).get("/api/openapi.json").expect(200);
    expect(r.body.paths["/api/purchase-orders/{id}/decision"]).toBeDefined();
  });
  it("sets security headers and a request id", async () => {
    const r = await request(app).get("/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-request-id"]).toBeTruthy();
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
  it("only workflow managers can change approval rules", async () => {
    await request(app).put("/api/workflow/rules").set("Authorization", `Bearer ${token(["FINANCE"])}`).send([]).expect(403);
  });
});

describe("sessions and new modules", () => {
  it("rejects tokens without a jti (pre-revocation tokens)", async () => {
    const legacy = jwt.sign({ uid: "t", roles: ["GLOBAL_CEO"] }, process.env.JWT_SECRET!);
    await request(app).get("/api/security/policies").set("Authorization", `Bearer ${legacy}`).expect(401);
  });
  it("rejects alg=none tokens", async () => {
    const none = jwt.sign({ uid: "t", roles: ["GLOBAL_CEO"] }, "", { algorithm: "none", jwtid: "x" });
    await request(app).get("/api/security/policies").set("Authorization", `Bearer ${none}`).expect(401);
  });
  it("security center is CEO/admin only", async () => {
    await request(app).get("/api/security/overview").set("Authorization", `Bearer ${token(["FINANCE"])}`).expect(403);
    const r = await request(app).get("/api/security/policies").set("Authorization", `Bearer ${token(["GLOBAL_CEO"])}`).expect(200);
    expect(r.body.matrix.find((m: { permission: string }) => m.permission === "po:approve:finance").roles).toEqual(["FINANCE"]);
  });
  it("only finance can change FX rates or post journals", async () => {
    await request(app).put("/api/finance/fx/EUR").set("Authorization", `Bearer ${token(["GLOBAL_CEO"])}`).send({ toUsd: 1.1 }).expect(403);
    await request(app).post("/api/finance/entries").set("Authorization", `Bearer ${token(["DEPARTMENT_MANAGER"])}`).send({}).expect(403);
  });
  it("only CEO/admin can create subsidiaries", async () => {
    await request(app).post("/api/org/companies").set("Authorization", `Bearer ${token(["REGIONAL_DIRECTOR"])}`).send({}).expect(403);
  });
});
