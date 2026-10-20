import { getProjectSlug } from "../helpers";
import { expect, test } from "../test.ts";

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

test("complex product areas share one local navigation layout", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2048, height: 1200 });
  const projectSlug = await getProjectSlug(page);
  const measurements: {
    name: string;
    navigationWidth: number;
    containerWidth: number;
    ground: { fill: string; rule: string };
  }[] = [];

  for (const section of sections) {
    await page.goto(section.path(projectSlug));

    const navigation = page.getByRole("navigation", {
      name: `${section.sectionLabel} navigation`,
    });
    const content = page.getByTestId("section-navigation-content");
    const container = page.getByTestId("section-navigation-layout");
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

    measurements.push({
      name: section.name,
      navigationWidth: navigationBox!.width,
      containerWidth: containerBox!.width,
      // The rail sits on the page's ground with no rule against the content (#8588).
      ground: await navigation.evaluate((element) => ({
        fill: getComputedStyle(element).backgroundColor,
        rule: getComputedStyle(element, "::after").content,
      })),
    });

    await page.screenshot({
      path: testInfo.outputPath(section.screenshot),
      fullPage: true,
    });
  }

  // One shared rail width; the exact pixel count is the design system's to choose.
  expect(new Set(measurements.map(({ navigationWidth }) => navigationWidth)).size).toBe(1);
  for (const { navigationWidth } of measurements) expect(navigationWidth).toBeGreaterThan(0);
  expect(new Set(measurements.map(({ containerWidth }) => containerWidth)).size).toBe(1);
  for (const { ground } of measurements) {
    expect(ground.fill).toBe("rgba(0, 0, 0, 0)");
    expect(ground.rule).toBe("none");
  }

  // The rail marks the page it is on: following one of its links moves the
  // active state off Overview.
  const automationsNavigation = page.getByRole("navigation", {
    name: "Automations navigation",
  });
  await automationsNavigation.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(`/${projectSlug}/automations/schedules`);

  // The rail marks the current entry with aria-current, not a fill of its own.
  await expect(
    automationsNavigation.getByRole("link", { name: "Reports", exact: true }),
  ).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
  await expect(
    automationsNavigation.getByRole("link", { name: "Overview", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");

  await page.goto(sections[0]!.path(projectSlug));
  await page.getByRole("radio", { name: "Set theme to dark" }).click();
  await expect(page.getByRole("navigation", { name: "Automations navigation" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("automations-shared-layout-dark.png"),
    fullPage: true,
  });
});
