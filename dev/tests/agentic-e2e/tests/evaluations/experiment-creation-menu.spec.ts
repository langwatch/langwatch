import { getProjectSlug } from "../helpers";
import { expect, test } from "../test.ts";

/** A page header's one primary action is solid; every other button is outline. */
const PRIMARY_ACTION = "rgb(221, 107, 32)";
const OUTLINE_ACTION = "rgba(0, 0, 0, 0)";

test("experiment creation keeps the SDK workflow discoverable", async ({ page }, testInfo) => {
  const projectSlug = await getProjectSlug(page);

  await page.goto(`/${projectSlug}/evaluations`);
  const newExperiment = page.getByRole("button", { name: "New Experiment" }).first();
  await expect(newExperiment).toHaveCSS("background-color", PRIMARY_ACTION);
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
    OUTLINE_ACTION,
  );
  await expect(page.getByRole("button", { name: "New Online Evaluation" }).first()).toHaveCSS(
    "background-color",
    PRIMARY_ACTION,
  );
  await expect(page.getByRole("heading", { name: "No online evaluations yet" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("online-evaluation-header-actions.png"),
  });
});
