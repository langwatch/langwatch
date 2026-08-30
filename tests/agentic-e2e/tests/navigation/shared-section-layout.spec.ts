import { expect, test } from "@playwright/test";

import { getProjectSlug } from "../helpers";

interface SectionCase {
  name: string;
  path: (projectSlug: string) => string;
  sectionLabel: string;
  pageHeading: string;
  screenshot: string;
}

// AI Gateway and AI Governance list their sections in the product sidebar
// of the navigation shell now, so their in-page section-nav rail stands
// down to avoid the duplicate. Automations still lists page-local
// destinations, so its rail keeps rendering in every mode.
const sections: SectionCase[] = [
  {
    name: "Automations",
    path: (projectSlug) => `/${projectSlug}/automations`,
    sectionLabel: "Automations",
    pageHeading: "Overview",
    screenshot: "automations-shared-layout.png",
  },
];

test("complex product areas share one local navigation layout", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 2048, height: 1200 });
  const projectSlug = await getProjectSlug(page);
  const measurements: Array<{
    name: string;
    navigationWidth: number;
    containerWidth: number;
    borderColor: string;
  }> = [];

  for (const section of sections) {
    await page.goto(section.path(projectSlug));

    const navigation = page.getByRole("navigation", {
      name: `${section.sectionLabel} navigation`,
    });
    const content = page.getByTestId("section-navigation-content");
    const container = page.getByTestId("section-navigation-container");
    const heading = page.getByRole("heading", {
      name: section.pageHeading,
      exact: true,
    });

    await expect(navigation).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(navigation.getByTestId("section-navigation-title")).toHaveText(
      section.sectionLabel,
    );

    const navigationBox = await navigation.boundingBox();
    const contentBox = await content.boundingBox();
    const containerBox = await container.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(containerBox).not.toBeNull();
    expect(navigationBox!.x).toBeLessThan(contentBox!.x);
    expect(containerBox!.width).toBeLessThanOrEqual(1600);

    measurements.push({
      name: section.name,
      navigationWidth: navigationBox!.width,
      containerWidth: containerBox!.width,
      borderColor: await navigation.evaluate(
        (element) => getComputedStyle(element).borderRightColor,
      ),
    });

    await page.screenshot({
      path: testInfo.outputPath(section.screenshot),
      fullPage: true,
    });
  }

  expect(measurements.map(({ navigationWidth }) => navigationWidth)).toEqual([
    220,
  ]);
  for (const { borderColor } of measurements) {
    expect(borderColor).not.toBe("rgb(0, 0, 0)");
    expect(borderColor).not.toBe("rgba(0, 0, 0, 0)");
  }

  await page.goto(sections[0]!.path(projectSlug));
  await page.getByRole("radio", { name: "Set theme to dark" }).click();
  await expect(
    page.getByRole("navigation", { name: "Automations navigation" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("automations-shared-layout-dark.png"),
    fullPage: true,
  });
});
