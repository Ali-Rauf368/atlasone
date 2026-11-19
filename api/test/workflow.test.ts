import { checkApprover, checkBudget, pickRule, validateRules, DEFAULT_RULES, type Rule } from "../src/lib/workflow.js";
import type { Role } from "../src/lib/rbac.js";

const u = (uid: string, ...roles: Role[]) => ({ uid, roles });
const pending = { status: "PENDING_APPROVAL" as const, createdBy: "manager" };

describe("approval matrix", () => {
  it("routes by amount band", () => {
    expect(pickRule(DEFAULT_RULES, 1_000).steps.map((s) => s.role)).toEqual(["FINANCE"]);
    expect(pickRule(DEFAULT_RULES, 5_000).steps.map((s) => s.role)).toEqual(["REGIONAL_DIRECTOR", "FINANCE"]);
    expect(pickRule(DEFAULT_RULES, 250_000).steps.map((s) => s.role)).toEqual(["REGIONAL_DIRECTOR", "FINANCE", "GLOBAL_CEO"]);
  });
  it("accepts the default matrix", () => expect(validateRules(DEFAULT_RULES)).toBeNull());
  it("rejects gaps between bands", () => {
    const bad: Rule[] = [{ ...DEFAULT_RULES[0], maxAmountUsd: 4_000 }, ...DEFAULT_RULES.slice(1)];
    expect(validateRules(bad)).toMatch(/Gap or overlap/);
  });
  it("requires a budget check in every chain", () => {
    const bad: Rule[] = [{ name: "x", minAmountUsd: 0, maxAmountUsd: null, steps: [{ role: "GLOBAL_CEO", label: "ok", slaHours: 1 }] }];
    expect(validateRules(bad)).toMatch(/budget-check/);
  });
  it("requires an open-ended last band", () => {
    expect(validateRules([{ ...DEFAULT_RULES[0], maxAmountUsd: 10 }])).toMatch(/open-ended/);
  });
});

describe("approver checks", () => {
  it("allows the role assigned to the current step", () => {
    expect(checkApprover(pending, { role: "REGIONAL_DIRECTOR" }, u("director", "REGIONAL_DIRECTOR"))).toEqual({ ok: true });
  });
  it("blocks other roles", () => {
    expect(checkApprover(pending, { role: "REGIONAL_DIRECTOR" }, u("finance", "FINANCE"))).toMatchObject({ ok: false, code: 403 });
  });
  it("does not let SUPER_ADMIN bypass a step", () => {
    expect(checkApprover(pending, { role: "GLOBAL_CEO" }, u("root", "SUPER_ADMIN"))).toMatchObject({ ok: false, code: 403 });
  });
  it("enforces segregation of duties", () => {
    expect(checkApprover({ ...pending, createdBy: "director" }, { role: "REGIONAL_DIRECTOR" }, u("director", "REGIONAL_DIRECTOR")))
      .toMatchObject({ ok: false, error: expect.stringMatching(/own PO/) });
  });
  it("returns 409 on finished orders", () => {
    expect(checkApprover({ ...pending, status: "REJECTED" }, undefined, u("finance", "FINANCE"))).toMatchObject({ ok: false, code: 409 });
  });
  it("checks budget headroom", () => {
    expect(checkBudget(1000, 400, 600).ok).toBe(true);
    expect(checkBudget(1000, 400, 600.01)).toMatchObject({ ok: false, error: expect.stringMatching(/600.00/) });
  });
});

describe("background jobs", () => {
  it("uses BullMQ-legal custom job ids (no ':', not an integer)", async () => {
    process.env.REDIS_URL = "";
    const { slaJobId } = await import("../src/lib/jobs.js");
    const id = slaJobId("clx123abc");
    expect(id).not.toContain(":");
    expect(Number.isInteger(Number(id))).toBe(false);
  });
});
