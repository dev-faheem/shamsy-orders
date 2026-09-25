import { expect, test, type Browser, type Page } from "@playwright/test";
import { createWorld, randomUUID } from "../db/harness";

/**
 * The worked example from the brief, played on a phone-sized screen against the real database.
 * Each run uses its own tenant and users (see tests/db/harness.ts).
 */

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;

test.beforeAll(async () => {
  w = await createWorld();
});

async function signIn(page: Page, who: "adviser" | "owner") {
  const u = w.users[who];
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/new/);
}

async function newSession(browser: Browser, who: "adviser" | "owner") {
  const context = await browser.newContext({ ...test.info().project.use });
  const page = await context.newPage();
  await signIn(page, who);
  return { context, page };
}

async function addLine(page: Page, sku: string, qty: number, discount: string) {
  const lines = page.locator("article[data-testid^='line-']");
  const before = await lines.count();
  await page.getByTestId(`add-${sku}`).click();
  await expect(lines).toHaveCount(before + 1);
  const line = page.getByTestId(`line-${before + 1}`); // pinned by position, not "last"
  await line.getByTestId("qty").fill(String(qty));
  await line.getByTestId("discount").fill(discount);
  return line;
}

async function startWorkedExample(page: Page) {
  await page.getByTestId("customer").selectOption({ label: "Ahmed Trading — Khartoum" });
  await expect(page.getByTestId("rate")).toHaveValue("8,200");
  const l1 = await addLine(page, "SPF-6000-ES-PLUS", 4, "40");
  const l2 = await addLine(page, "HOPE-5.0L-B1", 2, "70");
  const l3 = await addLine(page, "HOPE-16.0LM-A1", 1, "150");
  return { l1, l2, l3 };
}

test("worked example: colours, block, approval, stored rate", async ({ page, browser }) => {
  await signIn(page, "adviser");

  // --- The three lines, exactly as in the brief.
  const { l1, l2, l3 } = await startWorkedExample(page);
  await expect(l1.getByTestId("line-value")).toHaveText("$2,060");
  await expect(l1.getByTestId("discount-badge")).toHaveText("1.94% · Sand");
  await expect(l1.getByTestId("line-total")).toHaveText("$2,020");
  await expect(l1).toHaveAttribute("data-tier", "sand");

  await expect(l2.getByTestId("line-value")).toHaveText("$1,620");
  await expect(l2.getByTestId("discount-badge")).toHaveText("4.32% · Red");
  await expect(l2.getByTestId("line-total")).toHaveText("$1,550");
  await expect(l2).toHaveAttribute("data-tier", "red");

  await expect(l3.getByTestId("line-value")).toHaveText("$2,070");
  await expect(l3.getByTestId("discount-badge")).toHaveText("7.25% · Blocked");
  await expect(l3.getByTestId("line-total")).toHaveText("$1,920");
  await expect(l3).toHaveAttribute("data-tier", "blocked");

  // --- As the adviser, the order cannot be saved while line 3 is blocked.
  await expect(page.getByTestId("save")).toBeDisabled();
  await expect(page.getByTestId("blockers")).toContainText("needs the owner's approval");
  await page.screenshot({ path: "test-results/screens/1-blocked.png", fullPage: true });

  // --- Remove line 3: $3,570 = 29,274,000 SDG, and it saves.
  await l3.getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByTestId("total-usd")).toHaveText("$3,570");
  await expect(page.getByTestId("total-sdg")).toHaveText("29,274,000 SDG");
  await page.getByTestId("save").click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?saved=1/);
  await expect(page.getByTestId("stored-total-usd")).toHaveText("$3,570");
  await expect(page.getByTestId("stored-total-sdg")).toHaveText("29,274,000 SDG");
  await expect(page.getByTestId("order-number")).toContainText("SA-");

  // --- Again with line 3, and this time the owner approves it.
  await page.getByRole("link", { name: "New order" }).first().click();
  const again = await startWorkedExample(page);
  await again.l3.getByTestId("request-approval").click();
  await expect(again.l3.getByTestId("approval")).toContainText("Waiting for the owner");
  await expect(page.getByTestId("save")).toBeDisabled();

  const owner = await newSession(browser, "owner");
  await owner.page.goto("/approvals");
  const request = owner.page.getByTestId("approval-request").first();
  await expect(request).toContainText("Hope 16.0LM-A1");
  await expect(request).toContainText("7.25%");
  await owner.page.screenshot({ path: "test-results/screens/2-owner-approves.png", fullPage: true });
  await request.getByTestId("approve").click();
  await expect(owner.page.getByTestId("approval-request")).toHaveCount(0);

  // The adviser's screen picks up the approval by itself.
  await expect(again.l3.getByTestId("approval")).toContainText("Approved by the owner");
  await expect(again.l3.getByTestId("discount-badge")).toHaveText("7.25% · Approved");
  await expect(page.getByTestId("total-usd")).toHaveText("$5,490");
  await expect(page.getByTestId("total-sdg")).toHaveText("45,018,000 SDG");
  await page.screenshot({ path: "test-results/screens/3-approved.png", fullPage: true });
  await page.getByTestId("save").click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?saved=1/);
  const savedUrl = page.url().replace("?saved=1", "");
  await expect(page.getByTestId("stored-total-usd")).toHaveText("$5,490");
  await expect(page.getByTestId("stored-total-sdg")).toHaveText("45,018,000 SDG");

  // --- The owner changes the rate setting to 9,000; the saved order does not move.
  await owner.page.goto("/settings");
  await owner.page.getByTestId("day-rate").fill("9,000");
  await owner.page.getByTestId("save-rates").click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Rates saved" })).toBeVisible();

  await page.goto(savedUrl);
  await expect(page.getByTestId("stored-rate")).toHaveText("8,200");
  await expect(page.getByTestId("stored-total-sdg")).toHaveText("45,018,000 SDG");
  await expect(page.getByTestId("rate-differs")).toContainText("9,000");
  await page.screenshot({ path: "test-results/screens/4-rate-changed.png", fullPage: true });

  // New orders start at the new rate.
  await page.goto("/orders/new");
  await expect(page.getByTestId("rate")).toHaveValue("9,000");

  await owner.page.goto("/settings");
  await owner.page.getByTestId("day-rate").fill("8,200");
  await owner.page.getByTestId("save-rates").click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Rates saved" })).toBeVisible();
  await owner.context.close();
});

test("a rate of 7,900 is refused and returns to 8,000", async ({ page }) => {
  await signIn(page, "adviser");
  const rate = page.getByTestId("rate");
  await rate.fill("7,900");
  await expect(page.locator("#rate-help")).toHaveText("The rate cannot be below 8,000.");
  await expect(page.getByTestId("add-SPF-6000-ES-PLUS")).toBeDisabled(); // the add button refuses too
  await page.screenshot({ path: "test-results/screens/5-rate-below-min.png" });
  await rate.blur();
  await expect(rate).toHaveValue("8,000");
  await expect(page.locator("#rate-help")).toHaveText("Below the minimum — set back to 8,000.");
  await expect(page.getByTestId("add-SPF-6000-ES-PLUS")).toBeEnabled();
});

test("the server refuses 7.25% without approval, even when called directly", async ({ page, request }) => {
  const adviser = await w.signIn(w.users.adviser);
  const body = {
    client_ref: randomUUID(),
    customer_id: w.customer.id,
    rate: 8200,
    lines: [{ product_id: w.hope16.id, quantity: 1, discount_usd_cents: 15000 }],
  };

  // 1. The app's own endpoint, with the adviser's token.
  const viaApi = await request.post("/api/orders", { data: body, headers: { Authorization: `Bearer ${adviser.token}` } });
  expect(viaApi.status()).toBe(422);
  expect(await viaApi.json()).toMatchObject({ code: "DISCOUNT_NEEDS_APPROVAL" });

  // 2. The same endpoint with the browser's session cookie (what the screen itself uses).
  await signIn(page, "adviser");
  const viaCookie = await page.request.post("/api/orders", { data: { ...body, client_ref: randomUUID() } });
  expect(viaCookie.status()).toBe(422);

  // 3. Lying about the colour or the percentage changes nothing: the server recomputes.
  const lie = await request.post("/api/orders", {
    data: { ...body, client_ref: randomUUID(), lines: [{ ...body.lines[0], discount_bp: 100, discount_tier: "sand", unit_price_usd_cents: 207000 }] },
    headers: { Authorization: `Bearer ${adviser.token}` },
  });
  expect(lie.status()).toBe(422);

  // 4. Without a token: refused.
  const anon = await request.post("/api/orders", { data: body });
  expect([401, 403]).toContain(anon.status());
});

test("offline: the order is kept on the phone and sent when the connection returns", async ({ page, context }) => {
  await signIn(page, "adviser");
  await page.getByTestId("customer").selectOption({ label: "Nile Solar — Omdurman" });
  await expect(page.getByTestId("rate")).toHaveValue("8,200");
  await addLine(page, "SPF-6000-ES-PLUS", 4, "40");

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
  await page.getByTestId("save").click();
  await expect(page.getByText("No connection. The order is kept on this phone")).toBeVisible();
  await expect(page.getByText("1 order waiting to send")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/6-offline-queued.png" });

  await context.setOffline(false);
  await expect(page.getByText("1 order waiting to send")).toHaveCount(0, { timeout: 45_000 });
  await page.goto("/orders");
  await expect(page.getByText("Nile Solar — Omdurman").first()).toBeVisible();
  await expect(page.getByText("$2,020").first()).toBeVisible();
});
