import { getProjectSlug } from "../helpers";
import { expect, test } from "../test.ts";

test("experiment creation keeps the SDK workflow discoverable", async ({ page }, testInfo) => {
  const projectSlug = await getProjectSlug(page);

  await page.goto(`/${projectSlug}/evaluations`);
  const newExperiment = page.getByRole("button", { name: "New Experiment" }).first();
  // The solid primary button renders orange.600 (#DD6B20), as every solid orange does on main:
  // Langy's `_langyDark` orange.solid replaces the base #ED8926 when the themes merge.
  await expect(newExperiment).toHaveCSS("background-color", "rgb(221, 107, 32)");
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
    "rgb(221, 107, 32)",
  );
  await expect(page.getByRole("heading", { name: "No online evaluations yet" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("online-evaluation-header-actions.png"),
  });
});
