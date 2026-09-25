import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { createWorld } from "../db/harness";

/**
 * Every screen, as every role, must run without console errors or warnings, uncaught exceptions,
 * or failed requests. Refusals the app expects (e.g. a 422 it shows to the user) are not failures.
 */

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;

test.beforeAll(async () => {
  w = await createWorld();
});

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    // Navigations and prefetches cancelled by the next navigation are normal.
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(why)) return;
    problems.push(`requestfailed: ${r.method()} ${r.url()} ${why}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/orders")) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return problems;
}

/** On a phone the menu sits behind the ☰ button, as in the prototype. */
async function openMenu(page: Page) {
  const toggle = page.getByRole("button", { name: "Open menu" });
  if (await toggle.isVisible()) await toggle.click();
}

async function nav(page: Page, name: string) {
  await openMenu(page);
  await page.getByRole("navigation", { name: "Main menu" }).locator("..").getByRole("link", { name: new RegExp(`^${name}`) }).click(); // the badge adds "· n waiting"
}

async function signIn(page: Page, who: "adviser" | "owner") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(w.users[who].email);
  await page.getByLabel("Password").fill(w.users[who].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/new/);
  await expect(page.getByTestId("rate")).toHaveValue(/\d/);
}

test("adviser: every screen is console-clean", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(page, "adviser");

  await page.getByTestId("customer").selectOption({ index: 1 });
  await page.getByTestId("add-SPF-6000-ES-PLUS").click();
  await page.getByTestId("line-1").getByTestId("discount").fill("10"); // 1.94% of $515
  await page.getByTestId("add-HOPE-16.0LM-A1").click();
  await page.getByTestId("line-2").getByTestId("discount").fill("150");
  await page.getByTestId("line-2").getByTestId("request-approval").click();
  await expect(page.getByTestId("line-2").getByTestId("approval")).toContainText("Waiting");
  await page.getByTestId("line-2").getByRole("button", { name: /Remove/ }).click();
  await page.getByTestId("rate").fill("7,000");
  await page.getByTestId("rate").blur();
  await page.getByTestId("save").click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("stored-total-usd")).toBeVisible();

  await nav(page, "Orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await page.locator("a[href^='/orders/']").filter({ hasText: "SA-" }).first().click();
  await expect(page.getByTestId("stored-total-usd")).toBeVisible();

  // Owner-only screens refuse politely, without errors.
  await page.goto("/approvals");
  await expect(page.getByText("Only the owner")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText("Only the owner")).toBeVisible();

  await page.goto("/orders/new");
  await expect(page.getByTestId("rate")).toBeVisible();
  await openMenu(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  expect(problems, problems.join("\n")).toEqual([]);
});

test("owner: every screen is console-clean", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "owner");

  await page.getByTestId("customer").selectOption({ index: 2 });
  await page.getByTestId("add-HOPE-16.0LM-A1").click();
  await page.getByTestId("line-1").getByTestId("discount").fill("150");
  await page.getByTestId("line-1").getByTestId("request-approval").click();
  await expect(page.getByTestId("line-1").getByTestId("approval")).toContainText("Approved");
  await page.getByRole("button", { name: "Change price" }).click();
  await page.getByTestId("save").click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}/);

  await nav(page, "Approvals");
  await expect(page.getByRole("heading", { name: "Discount approvals", exact: true })).toBeVisible();
  await nav(page, "Settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByTestId("save-rates").click();
  await expect(page.getByRole("status").filter({ hasText: "Rates saved" })).toBeVisible();
  await nav(page, "Orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();

  expect(problems, problems.join("\n")).toEqual([]);
});

test("quantity can be typed freely, and the new line scrolls into view", async ({ page }) => {
  await signIn(page, "adviser");
  await page.getByTestId("customer").selectOption({ index: 1 });
  await page.getByTestId("add-SPF-6000-ES-PLUS").click();
  const qty = page.getByTestId("line-1").getByTestId("qty");
  await qty.fill(""); // cleared while typing: stays empty, the line keeps its last quantity
  await expect(qty).toHaveValue("");
  await qty.pressSequentially("12");
  await expect(qty).toHaveValue("12");
  await expect(page.getByTestId("line-1").getByTestId("line-value")).toHaveText("$6,180");
  await qty.fill("");
  await qty.blur();
  await expect(qty).toHaveValue("12");
  await expect(page.getByTestId("line-1")).toBeInViewport();

  // Start over asks first.
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByTestId("line-1")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByTestId("line-1")).toHaveCount(0);

  // Already signed in: /login goes straight to the order screen.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/orders\/new/);
});

test("nothing scrolls sideways on a small 360px phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, "owner");
  await page.getByTestId("customer").selectOption({ index: 1 });
  await page.getByTestId("add-HOPE-16.0LM-A1").click();
  await page.getByTestId("line-1").getByTestId("discount").fill("150");
  for (const path of ["/orders/new", "/orders", "/approvals", "/settings"]) {
    if (path !== "/orders/new") await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} is ${overflow}px too wide`).toBeLessThanOrEqual(0);
  }
  await page.goto("/login");
  await context.close();
});
