import { getProjectSlug } from "../helpers";
import { expect, test } from "../test.ts";

test("experiment creation keeps the SDK workflow discoverable", async ({ page }, testInfo) => {
  const projectSlug = await getProjectSlug(page);

  await page.goto(`/${projectSlug}/evaluations`);
  const newExperiment = page.getByRole("button", { name: "New Experiment" }).first();
  // Header buttons are all outlined; the page's main act is marked, not filled (#8588).
  await expect(newExperiment).toHaveAttribute("data-primary", "");
  await newExperiment.click();
  const sdkExperiment = page.getByRole("menuitem", {
    name: /With the SDK/,
  });
  await expect(sdkExperiment).toHaveAttribute(
    "href",
    "https://langwatch.ai/docs/evaluations/experiments/sdk",
  );
  await page.screenshot({
    path: testInfo.outputPath("experiment-creation-menu.png"),
  });

  await page.goto(`/${projectSlug}/online-evaluations`);
  // A secondary header action is never marked as the page's main act.
  const guardrail = page.getByRole("button", { name: "Set up guardrail" }).first();
  await expect(guardrail).toBeVisible();
  await expect(guardrail).not.toHaveAttribute("data-primary");
  // The page's one main act (D63), marked as New Experiment above.
  await expect(page.getByRole("button", { name: "New Online Evaluation" }).first()).toHaveAttribute(
    "data-primary",
    "",
  );
  await expect(page.getByRole("heading", { name: "No online evaluations yet" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("online-evaluation-header-actions.png"),
  });
});
