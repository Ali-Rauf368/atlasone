import { can } from "../src/lib/rbac.js";
import { linearForecast, nextPeriod } from "../src/lib/forecast.js";

describe("rbac", () => {
  it("grants the CEO the global dashboard but not PO creation", () => {
    expect(can(["GLOBAL_CEO"], "dashboard:global")).toBe(true);
    expect(can(["GLOBAL_CEO"], "po:create")).toBe(false);
  });
  it("denies employees everything sensitive", () => {
    expect(can(["EMPLOYEE"], "audit:read")).toBe(false);
    expect(can(["EMPLOYEE"], "payroll:read")).toBe(false);
  });
});

describe("forecast", () => {
  it("rolls periods over year end", () => expect(nextPeriod("2026-11", 3)).toBe("2027-02"));
  it("projects a perfect linear trend exactly", () => {
    const s = [100, 200, 300].map((value, i) => ({ period: `2026-0${i + 1}`, value }));
    expect(linearForecast(s, 2)).toEqual([{ period: "2026-04", value: 400 }, { period: "2026-05", value: 500 }]);
  });
  it("needs at least two points", () => expect(linearForecast([{ period: "2026-01", value: 1 }], 3)).toEqual([]));
});
