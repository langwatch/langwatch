import { expect, test, type Locator } from "@playwright/test";

import { getProjectSlug } from "../helpers";

const expectNormalTextLink = async (link: Locator) => {
  await expect(link).toBeVisible();
  await expect(link).toHaveCSS("text-decoration-line", "underline");
  const linkColor = await link.evaluate(
    (element: HTMLElement) => window.getComputedStyle(element).color,
  );
  const textColor = await link
    .locator("xpath=..")
    .evaluate((element: HTMLElement) => window.getComputedStyle(element).color);
  expect(linkColor).toBe(textColor);
};

test("documentation links use normal text with an underline and section carets stay dim", async ({
  page,
}, testInfo) => {
  const projectSlug = await getProjectSlug(page);

  await page.goto(`/${projectSlug}/online-evaluations`);
  const onlineDocumentation = page.getByRole("link", {
    name: "online evaluations documentation",
  });
  await expectNormalTextLink(onlineDocumentation);
  await expect(page.getByRole("link", { name: "Online Evals" })).toBeVisible();
  const observeSection = page.getByRole("button", { name: "Collapse Observe" });
  await expect(observeSection.locator("svg")).toHaveCount(0);
  await observeSection.click();
  const collapsedObserveSection = page.getByRole("button", {
    name: "Expand Observe",
  });
  const observeCaret = collapsedObserveSection
    .locator("svg")
    .locator("xpath=..");
  await expect(observeCaret).toHaveCSS("opacity", "0.5");
  const governSection = page.getByRole("button", { name: "Expand Govern" });
  await expect(governSection.locator("svg")).toHaveCount(1);
  await expect(governSection.locator("svg").locator("xpath=..")).toHaveCSS(
    "opacity",
    "0.5",
  );
  await page.screenshot({
    path: testInfo.outputPath("online-evals-underlined-link.png"),
  });

  await page.goto(`/${projectSlug}/evaluations`);
  const experimentDocumentation = page.getByRole("link", {
    name: "experiments documentation",
  });
  await expectNormalTextLink(experimentDocumentation);
  await page.screenshot({
    path: testInfo.outputPath("experiments-underlined-link.png"),
  });

  await page.goto(`/${projectSlug}/datasets`);
  const datasetDocumentation = page.getByRole("link", {
    name: "documentation",
  });
  await expectNormalTextLink(datasetDocumentation);
  await page.screenshot({
    path: testInfo.outputPath("datasets-underlined-link.png"),
  });
});
