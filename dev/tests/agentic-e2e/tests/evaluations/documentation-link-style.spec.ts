import { getProjectSlug } from "../helpers";
import { expect, test, type Page } from "../test.ts";

// The design system's empty state owns the docs link's wording and tone; the page, its address.
const expectDocumentationLink = async (page: Page, href: string) => {
  const link = page.locator(`a[href="${href}"]`).first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
};

test("empty pages link to their documentation and section carets stay dim", async ({
  page,
}, testInfo) => {
  const projectSlug = await getProjectSlug(page);

  await page.goto(`/${projectSlug}/online-evaluations`);
  await expectDocumentationLink(
    page,
    "https://docs.langwatch.ai/evaluations/online-evaluation/overview",
  );
  await expect(page.getByRole("link", { name: "Online Evals" })).toBeVisible();
  const observeSection = page.getByRole("button", { name: "Collapse Observe" });
  await expect(observeSection.locator("svg")).toHaveCount(0);
  await observeSection.click();
  const collapsedObserveSection = page.getByRole("button", {
    name: "Expand Observe",
  });
  const observeCaret = collapsedObserveSection.locator("svg").locator("xpath=..");
  await expect(observeCaret).toHaveCSS("opacity", "0.5");
  await page.screenshot({
    path: testInfo.outputPath("online-evals-underlined-link.png"),
  });

  await page.goto(`/${projectSlug}/evaluations`);
  await expectDocumentationLink(page, "https://langwatch.ai/docs/evaluations/experiments/overview");
  await page.screenshot({
    path: testInfo.outputPath("experiments-underlined-link.png"),
  });

  await page.goto(`/${projectSlug}/datasets`);
  await expectDocumentationLink(page, "https://docs.langwatch.ai/datasets/overview");
  await page.screenshot({
    path: testInfo.outputPath("datasets-underlined-link.png"),
  });
});
