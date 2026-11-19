import { detectAnomalies } from "../src/lib/anomaly.js";
import { hashEntry } from "../src/models/audit.js";

describe("anomaly detection", () => {
  const base = [100, 104, 98, 101, 99, 103, 97, 102].map((v, i) => ({ period: `2026-0${i + 1}`, value: v }));
  it("finds nothing in normal noise", () => expect(detectAnomalies(base)).toEqual([]));
  it("flags a spike and a drop", () => {
    const s = [...base, { period: "2026-09", value: 180 }, { period: "2026-10", value: 20 }];
    const found = detectAnomalies(s);
    expect(found.map((a) => [a.period, a.direction])).toEqual([["2026-09", "spike"], ["2026-10", "drop"]]);
  });
  it("is not fooled by the outlier itself (robust statistics)", () => {
    const s = [...base, { period: "2026-09", value: 10_000 }];
    expect(detectAnomalies(s)).toHaveLength(1);
  });
  it("needs at least 4 points", () => expect(detectAnomalies(base.slice(0, 3))).toEqual([]));
});

describe("audit hash chain", () => {
  const e = { seq: 1, at: new Date("2026-11-19T10:00:00Z"), actor: { uid: "ceo", name: "CEO", roles: ["GLOBAL_CEO"] }, action: "PO_CREATED", entity: "PurchaseOrder", entityId: "p1", details: { amount: 5 } };
  it("is deterministic", () => expect(hashEntry("GENESIS", e)).toBe(hashEntry("GENESIS", { ...e })));
  it("changes when any field is tampered with", () => {
    const h = hashEntry("GENESIS", e);
    expect(hashEntry("GENESIS", { ...e, details: { amount: 6 } })).not.toBe(h);
    expect(hashEntry("GENESIS", { ...e, actor: { ...e.actor, uid: "x" } })).not.toBe(h);
    expect(hashEntry("other", e)).not.toBe(h);
  });
});
