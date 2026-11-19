import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.evaluate(() => localStorage.clear());
  await page.getByPlaceholder("Username").fill(user);
  await page.getByPlaceholder("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function createPo(page: Page, supplier: string, amount: string) {
  await page.goto("/purchase-orders");
  await page.locator("select").first().selectOption({ label: "AtlasOne Technology GmbH (EUR)" });
  await page.getByPlaceholder("Supplier").fill(supplier);
  await page.getByPlaceholder("Description").fill("E2E order");
  await page.getByPlaceholder(/Amount/).fill(amount);
  await page.getByRole("button", { name: "Create PO" }).click();
  await expect(page.getByText(/submitted · route/)).toBeVisible();
}

async function approveFromInbox(page: Page, supplier: string) {
  await page.goto("/purchase-orders");
  page.once("dialog", (d) => d.accept("ok"));
  const row = page.locator("div.py-3", { hasText: supplier });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("div.py-3", { hasText: supplier })).toHaveCount(0); // leaves my inbox
}

// Repeatable runs: give DE enough budget headroom for the POs below (via the Finance API)
test.beforeAll(async ({ request }) => {
  const api = process.env.API_URL ?? new URL("/", process.env.BASE_URL ?? "http://localhost:5173").origin;
  const { token } = await (await request.post(`${api}/api/auth/login`, { data: { username: "finance", password: "password" } })).json();
  const headers = { Authorization: `Bearer ${token}` };
  const budgets = await (await request.get(`${api}/api/reports/budgets`, { headers })).json();
  const de = budgets.find((b: { company: string }) => b.company === "AtlasOne Technology GmbH");
  await request.put(`${api}/api/finance/budgets/${de.companyId}/2026`, { headers, data: { amountUsd: de.spentUsd + 1_000_000 } });
});

test("CEO sees dashboard and anomaly panel", async ({ page }) => {
  await login(page, "ceo");
  await expect(page.getByRole("heading", { name: "Global CEO dashboard" })).toBeVisible();
  await expect(page.getByText(/Anomaly detection/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "AtlasOne Manufacturing Inc" }).first()).toBeVisible();
});

test("standard PO: manager → director → finance → supplier, audited and hash-verified", async ({ page }) => {
  const supplier = `E2E Std ${Date.now()}`;
  await login(page, "manager");
  await createPo(page, supplier, "5000"); // €5k ≈ $5.4k → standard band (2 steps)

  await login(page, "director");
  await approveFromInbox(page, supplier);
  await login(page, "finance");
  await approveFromInbox(page, supplier);

  await page.getByRole("button", { name: "All orders" }).click();
  await expect(page.locator("div.py-3", { hasText: supplier })).toContainText("SENT TO SUPPLIER");

  await page.goto("/audit");
  await expect(page.getByRole("cell", { name: "PO_SENT_TO_SUPPLIER" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.getByText(/Hash chain intact/)).toBeVisible();
});

test("strategic PO needs CEO sign-off", async ({ page }) => {
  const supplier = `E2E Strategic ${Date.now()}`;
  await login(page, "manager");
  await createPo(page, supplier, "150000"); // ≥ $100k → 3 steps
  await login(page, "director");
  await approveFromInbox(page, supplier);
  await login(page, "finance");
  await approveFromInbox(page, supplier);
  await login(page, "ceo");
  await approveFromInbox(page, supplier);
});

test("data scoping: Pakistan manager cannot see German orders", async ({ page }) => {
  await login(page, "manager.pk");
  await page.goto("/purchase-orders");
  await page.getByRole("button", { name: "All orders" }).click();
  await expect(page.getByText("AtlasOne Technology GmbH")).toHaveCount(0);
});

test("managers cannot see the audit log or workflow rules", async ({ page }) => {
  await login(page, "manager");
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Workflow rules" })).toHaveCount(0);
});
