import { expect, test } from "@playwright/test";

import { getProjectSlug } from "../helpers";

test("automation overview keeps activity and setup guidance", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const projectSlug = await getProjectSlug(page);
  const basePath = `/${projectSlug}/automations`;

  await page.goto(basePath);
  await expect(page.locator("h1", { hasText: "Overview" })).toBeVisible();
  await expect(
    page.locator(`a[href="${basePath}/alerts"]`),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Recent activity")).toBeVisible();
  await expect(page.getByText("Error spike")).toBeVisible();
  await expect(page.getByText("Traffic drop")).toBeVisible();
  await expect(page.getByText("Cost spike")).toBeVisible();
  await expect(page.getByText("Flag failing evaluations")).toBeVisible();
  await expect(page.getByText("Build a dataset from errors")).toBeVisible();
  await expect(page.getByText("Queue for review")).toBeVisible();
  await page.getByRole("button", { name: "Expand Library" }).click();
  await expect(
    page.locator(`a[href="${basePath}"]`, { hasText: "Automations" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("automations.png") });

  await page.getByRole("link", { name: "Alerts", exact: true }).last().click();
  await expect(page).toHaveURL(`${basePath}/alerts`);
  await expect(page.locator("h1", { hasText: "Alerts" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New alert" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Error spike")).toBeVisible();
  await expect(page.getByText("Traffic drop")).toBeVisible();
  await expect(page.getByText("Cost spike")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("alerts.png") });

  await page.getByRole("link", { name: "Schedules", exact: true }).click();
  await expect(page).toHaveURL(`${basePath}/schedules`);
  await expect(page.locator("h1", { hasText: "Schedules" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New schedule" }).first(),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("schedules.png") });

  await page.getByRole("link", { name: "Automations", exact: true }).last().click();
  await expect(page).toHaveURL(`${basePath}/automations`);
  await expect(
    page.locator("h1", { hasText: "Automations" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("activity.png") });
});
