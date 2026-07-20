import { expect, test } from "@playwright/test";

import { getProjectSlug } from "../helpers";

test("automation pages separate alerts, schedules, and activity", async ({
  page,
}, testInfo) => {
  const projectSlug = await getProjectSlug(page);
  const basePath = `/${projectSlug}/automations`;

  await page.goto(basePath);
  await expect(page.locator("h1", { hasText: "Automations" })).toBeVisible();
  await expect(
    page.locator(`a[href="${basePath}/alerts"]`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New automation" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand Library" }).click();
  await expect(page.locator(`a[href="${basePath}"]`)).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("automations.png") });

  await page.getByRole("link", { name: "Alerts", exact: true }).last().click();
  await expect(page).toHaveURL(`${basePath}/alerts`);
  await expect(page.locator("h1", { hasText: "Alerts" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New alert" }).first(),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("alerts.png") });

  await page.getByRole("link", { name: "Schedules", exact: true }).click();
  await expect(page).toHaveURL(`${basePath}/schedules`);
  await expect(page.locator("h1", { hasText: "Schedules" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New schedule" }).first(),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("schedules.png") });

  await page.getByRole("link", { name: "Recent activity", exact: true }).click();
  await expect(page).toHaveURL(`${basePath}/activity`);
  await expect(
    page.locator("h1", { hasText: "Recent activity" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("activity.png") });
});
