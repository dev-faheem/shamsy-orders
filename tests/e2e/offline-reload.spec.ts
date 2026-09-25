import { expect, test, type Page } from "@playwright/test";
import { createWorld } from "../db/harness";

/**
 * The adviser opens the app once while online. Later she has no signal and opens it again:
 * the screen must load from the phone, let her build and save an order, and send it
 * when the connection returns. Needs a production build (the service worker is off in dev).
 */

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;

test.beforeAll(async () => {
  w = await createWorld();
});

async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker?.ready;
    return Boolean(reg?.active && navigator.serviceWorker.controller);
  }, null, { timeout: 30_000 });
}

test("opening or reloading the app while offline still records the order, and it syncs later", async ({ page, context }) => {
  // --- Online, once: sign in and open the order screen.
  await page.goto("/login");
  await page.getByLabel("Email").fill(w.users.adviser.email);
  await page.getByLabel("Password").fill(w.users.adviser.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/new/);
  await expect(page.getByTestId("rate")).toHaveValue("8,200"); // catalogue loaded and kept on the phone
  await waitForServiceWorker(page);
  // A second online load goes through the service worker, which keeps the page and its scripts.
  await page.reload();
  await expect(page.getByTestId("rate")).toHaveValue("8,200");

  // --- No signal. Reload the app from scratch.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "New order" })).toBeVisible();
  await expect(page.getByText("Offline — using the product list saved on this phone.")).toBeVisible();
  await expect(page.getByTestId("rate")).toHaveValue("8,200");

  // Build and save the order with no connection at all.
  await page.getByTestId("customer").selectOption({ label: "Dongola Power — Dongola" });
  await page.getByTestId("add-SPF-6000-ES-PLUS").click();
  await page.getByTestId("line-1").getByTestId("qty").fill("4");
  await page.getByTestId("line-1").getByTestId("discount").fill("40");
  await expect(page.getByTestId("total-usd")).toHaveText("$2,020");
  await expect(page.getByTestId("total-sdg")).toHaveText("16,564,000 SDG");
  await page.getByTestId("save").click();
  await expect(page.getByText("No connection. The order is kept on this phone")).toBeVisible();
  await expect(page.getByText("1 order waiting to send")).toBeVisible();

  // Still offline, the app is reloaded again: the queued order is still there.
  await page.reload();
  await expect(page.getByText("1 order waiting to send")).toBeVisible();

  // --- Signal returns: the order is sent by itself, once.
  await context.setOffline(false);
  await expect(page.getByText("1 order waiting to send")).toHaveCount(0, { timeout: 45_000 });

  const adviser = await w.signIn(w.users.adviser);
  const { data } = await adviser.client
    .from("orders")
    .select("order_number, total_usd_cents, total_sdg_piastres, rate_sdg_per_usd, customers(name)")
    .eq("customer_id", w.customers.find((c) => c.name === "Dongola Power")!.id);
  expect(data).toHaveLength(1);
  expect(data![0]).toMatchObject({ total_usd_cents: 202000, total_sdg_piastres: 1656400000, rate_sdg_per_usd: 8200 });
});
