import { PrismaClient } from "@prisma/client";
import { DEFAULT_RULES } from "../src/lib/workflow.js";
const prisma = new PrismaClient();

// Illustrative demo data only.
const fx: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, PKR: 0.0036, SGD: 0.74, JPY: 0.0066 };
const subs = [
  { code: "DE-TECH", name: "AtlasOne Technology GmbH", country: "Germany", region: "Europe", currency: "EUR", industry: "Technology", rev: 950_000, exp: 720_000, emp: 40 },
  { code: "PK-PHARMA", name: "AtlasOne Pharma Pvt Ltd", country: "Pakistan", region: "Asia", currency: "PKR", industry: "Pharmaceutical", rev: 180_000_000, exp: 150_000_000, emp: 55 },
  { code: "US-MFG", name: "AtlasOne Manufacturing Inc", country: "USA", region: "Americas", currency: "USD", industry: "Manufacturing", rev: 1_400_000, exp: 1_330_000, emp: 70 },
  { code: "UK-LOG", name: "AtlasOne Logistics Ltd", country: "United Kingdom", region: "Europe", currency: "GBP", industry: "Logistics", rev: 520_000, exp: 430_000, emp: 30 },
  { code: "SG-APAC", name: "AtlasOne APAC Office", country: "Singapore", region: "Asia", currency: "SGD", industry: "Regional HQ", rev: 300_000, exp: 280_000, emp: 15 },
];

const first = ["Anna", "Bilal", "Chloe", "Daniel", "Elif", "Farah", "George", "Hina", "Ivan", "Julia", "Kamran", "Lena"];
const last = ["Schmidt", "Khan", "Smith", "Brown", "Ahmed", "Müller", "Taylor", "Lee", "Malik", "Wilson"];
const titles = ["Analyst", "Engineer", "Specialist", "Coordinator", "Team Lead", "Associate"];
const skus = ["RAW-STEEL-01", "PKG-BOX-M", "CHIP-MCU-32", "API-COMP-7", "PALLET-EU"];
const clients = ["Northwind", "Contoso", "Globex"];
const suppliers = [["Siemens Supply Hub", "Germany"], ["Karachi Chemicals", "Pakistan"], ["Pacific Components", "USA"], ["Thames Freight", "United Kingdom"], ["Lion City Parts", "Singapore"]];

async function main() {
  const countries: [string, string, string, number, number, string, string][] = [
    ["Germany", "Europe/Berlin", "de-DE", 1, 19, "MONTHLY", "EU"], ["Pakistan", "Asia/Karachi", "en-PK", 7, 18, "MONTHLY", "LOCAL"],
    ["USA", "America/New_York", "en-US", 1, 0, "BIWEEKLY", "US"], ["United Kingdom", "Europe/London", "en-GB", 4, 20, "MONTHLY", "UK"],
    ["Singapore", "Asia/Singapore", "en-SG", 4, 9, "MONTHLY", "APAC"]];
  for (const [country, timezone, locale, fiscalYearStartMonth, vatRate, payrollCycle, dataResidency] of countries)
    await prisma.countryConfig.upsert({ where: { country }, update: {}, create: { country, timezone, locale, fiscalYearStartMonth, vatRate, payrollCycle, dataResidency } });
  for (const r of DEFAULT_RULES)
    await prisma.workflowRule.upsert({ where: { name: r.name }, update: {}, create: { ...r, steps: r.steps as never } });
  for (const [name, country] of suppliers)
    await prisma.supplier.upsert({ where: { name }, update: {}, create: { name, country, email: `orders@${name.split(" ")[0].toLowerCase()}.example`, rating: 4 } });
  if (!(await prisma.shipment.count()))
    await prisma.shipment.createMany({ data: [
      { tracking: "TRK-DEMO-1", origin: "Hamburg", destination: "Lahore", status: "IN_TRANSIT", eta: new Date(Date.now() + 5 * 864e5) },
      { tracking: "TRK-DEMO-2", origin: "Shenzhen", destination: "Chicago", status: "DELAYED", eta: new Date(Date.now() + 2 * 864e5) },
      { tracking: "TRK-DEMO-3", origin: "Rotterdam", destination: "London", status: "DELIVERED", eta: new Date(Date.now() - 3 * 864e5) } ] });
  for (const [currency, toUsd] of Object.entries(fx)) await prisma.fxRate.upsert({ where: { currency }, update: { toUsd }, create: { currency, toUsd } });
  const parent = await prisma.company.upsert({ where: { code: "GLOBAL" }, update: {},
    create: { code: "GLOBAL", name: "AtlasOne Holdings", country: "USA", region: "Global", currency: "USD", industry: "Holding" } });

  for (const s of subs) {
    const c = await prisma.company.upsert({ where: { code: s.code }, update: {},
      create: { code: s.code, name: s.name, country: s.country, region: s.region, currency: s.currency, industry: s.industry, parentId: parent.id } });
    if (await prisma.financialEntry.count({ where: { companyId: c.id } })) continue;

    const depts = [];
    for (const d of ["Finance", "Operations", "Sales", "HR"]) depts.push(await prisma.department.create({ data: { name: d, companyId: c.id } }));
    await prisma.employee.createMany({ data: Array.from({ length: s.emp }, (_, i) => ({
      name: `${first[i % first.length]} ${last[(i * 7 + s.code.length) % last.length]}`, email: `e${i + 1}.${s.code.toLowerCase()}@atlasone.dev`,
      title: titles[i % titles.length], companyId: c.id, departmentId: depts[i % depts.length].id,
      status: i < 2 ? "ONBOARDING" : "ACTIVE", salary: Math.round((s.exp * 0.4) / s.emp), rating: 1 + (i % 5) })) });
    const emps = await prisma.employee.findMany({ where: { companyId: c.id }, select: { id: true } });
    const days = Array.from({ length: 20 }, (_, d) => new Date(Date.UTC(2026, 9, d + 1)));
    await prisma.attendance.createMany({ data: emps.flatMap((e) => days.map((date) => ({ employeeId: e.id, date, present: Math.random() > 0.06 }))) });
    await prisma.leaveRequest.create({ data: { employeeId: emps[3].id, from: new Date("2026-12-20"), to: new Date("2026-12-31"), reason: "Annual leave" } });
    await prisma.jobOpening.create({ data: { companyId: c.id, title: `${s.industry} Analyst` } });

    const wh = await prisma.warehouse.create({ data: { name: `${s.country} Central`, city: s.country, companyId: c.id } });
    await prisma.inventoryItem.createMany({ data: skus.map((k, i) => ({ sku: k, name: k.replace(/-/g, " "), quantity: i === 0 ? 8 : 100 + i * 40, reorderAt: 20, warehouseId: wh.id })) });

    for (let k = 0; k < 3; k++) {
      const cust = await prisma.customer.create({ data: { name: `${clients[k]} ${s.country}`, country: s.country, industry: s.industry, companyId: c.id } });
      const stages = ["LEAD", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
      for (let j = 0; j < 3; j++)
        await prisma.deal.create({ data: { title: `${s.industry} deal ${k + 1}.${j + 1}`, customerId: cust.id, stage: stages[(k + j * 2) % 5],
          valueUsd: 20_000 + ((k * 37 + j * 53) % 10) * 15_000, owner: ["director", "manager"][j % 2] } });
      await prisma.contract.create({ data: { customerId: cust.id, title: "Master services agreement", valueUsd: 250_000 + k * 100_000,
        startsAt: new Date("2026-01-01"), endsAt: new Date(2027, k * 4, 1) } });
    }
    for (let m = 1; m <= 10; m++) {
      const period = `2026-${String(m).padStart(2, "0")}`, jitter = 0.9 + Math.random() * 0.2;
      for (const [type, base] of [["REVENUE", s.rev], ["EXPENSE", s.exp]] as const) {
        // Planted anomaly for the demo: US manufacturing expense spike in October
        const spike = s.code === "US-MFG" && type === "EXPENSE" && m === 10 ? 1.8 : 1;
        const amount = Math.round(base * jitter * spike);
        await prisma.financialEntry.create({ data: { companyId: c.id, period, type, category: type === "REVENUE" ? "Sales" : "Operating costs",
          amount, currency: s.currency, amountUsd: Math.round(amount * fx[s.currency] * 100) / 100, source: "seed" } });
      }
    }
    await prisma.budget.create({ data: { companyId: c.id, year: 2026, amountUsd: Math.round(s.exp * fx[s.currency] * 0.5) } });
  }
  console.log("Seeded.");
}
main().finally(() => prisma.$disconnect());
