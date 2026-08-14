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
  // Automations and alerts are one list now (ADR-093 §1), so there is no
  // Alerts tab to navigate to.
  await expect(page.locator(`a[href="${basePath}/alerts"]`)).toHaveCount(0);
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
  await page.getByRole("button", { name: "Expand Build" }).click();
  await expect(
    page.locator(`a[href="${basePath}"]`, { hasText: "Automations" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("automations.png") });

  // A link issued before the merge still lands somewhere useful: the old
  // alerts path resolves to the one automations page (the path carries no
  // row identity — that lives in the drawer parameters).
  await page.goto(`${basePath}/alerts`);
  await expect(page.locator("h1", { hasText: "Automations" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New automation" }),
  ).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("alerts.png") });

  // The tab is called Reports; the path it shipped under keeps answering, so
  // no existing link breaks.
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(`${basePath}/schedules`);
  await expect(page.locator("h1", { hasText: "Reports" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New report" })).toHaveCount(
    1,
  );
  await page.screenshot({ path: testInfo.outputPath("schedules.png") });

  await page
    .getByRole("link", { name: "Automations", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(`${basePath}/automations`);
  await expect(page.locator("h1", { hasText: "Automations" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New automation" }),
  ).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("activity.png") });
});
