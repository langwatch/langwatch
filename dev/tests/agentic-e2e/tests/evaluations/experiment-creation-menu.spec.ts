import { getProjectSlug } from "../helpers";
import { expect, test } from "../test.ts";

test("experiment creation keeps the SDK workflow discoverable", async ({ page }, testInfo) => {
  const projectSlug = await getProjectSlug(page);

  await page.goto(`/${projectSlug}/evaluations`);
  const newExperiment = page.getByRole("button", { name: "New Experiment" }).first();
  // The solid primary button renders the brand orange.solid (#ED8926), a deliberate change
  // from main's #DD6B20, which Langy's `_langyDark` override replaced when the themes merged.
  await expect(newExperiment).toHaveCSS("background-color", "rgb(237, 137, 38)");
  await newExperiment.click();
  const sdkExperiment = page.getByRole("menuitem", {
    name: /New Experiment via SDK/,
  });
  await expect(sdkExperiment).toHaveAttribute(
    "href",
    "https://langwatch.ai/docs/evaluations/experiments/sdk",
  );
  await page.screenshot({
    path: testInfo.outputPath("experiment-creation-menu.png"),
  });

  await page.goto(`/${projectSlug}/online-evaluations`);
  await expect(page.getByRole("button", { name: "Set up Guardrail" }).first()).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  // The page's one solid primary action (D63), orange as New Experiment above.
  await expect(page.getByRole("button", { name: "New Online Evaluation" }).first()).toHaveCSS(
    "background-color",
    "rgb(237, 137, 38)",
  );
  await expect(page.getByRole("heading", { name: "No online evaluations yet" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("online-evaluation-header-actions.png"),
  });
});
