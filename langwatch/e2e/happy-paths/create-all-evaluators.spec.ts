import { expect, test } from "@playwright/test";

import { AVAILABLE_EVALUATORS } from "../../src/server/evaluations/evaluators.generated";

/**
 * Creates every UI-exposed evaluator with default settings to prove the
 * Zod-first schemas (post ts-to-zod migration) actually render, validate,
 * persist, and list end-to-end.
 *
 * The catalog below mirrors `evaluatorCategoryMap` in
 * `src/components/evaluators/EvaluatorTypeSelectorDrawer.tsx`. If that map
 * changes, update here too — keys are type-checked against AVAILABLE_EVALUATORS.
 */

type CategoryId =
  | "expected_answer"
  | "llm_judge"
  | "rag"
  | "quality"
  | "safety";

type EvaluatorKey = keyof typeof AVAILABLE_EVALUATORS;

const UI_EVALUATORS: ReadonlyArray<{
  category: CategoryId;
  type: EvaluatorKey;
}> = [
  { category: "expected_answer", type: "langevals/exact_match" },
  { category: "expected_answer", type: "langevals/llm_answer_match" },
  { category: "expected_answer", type: "ragas/factual_correctness" },
  { category: "expected_answer", type: "ragas/rouge_score" },
  { category: "expected_answer", type: "ragas/bleu_score" },

  { category: "llm_judge", type: "langevals/llm_boolean" },
  { category: "llm_judge", type: "langevals/llm_score" },
  { category: "llm_judge", type: "langevals/llm_category" },
  { category: "llm_judge", type: "ragas/rubrics_based_scoring" },

  { category: "rag", type: "ragas/faithfulness" },
  { category: "rag", type: "ragas/response_relevancy" },
  { category: "rag", type: "ragas/response_context_recall" },
  { category: "rag", type: "ragas/response_context_precision" },
  { category: "rag", type: "ragas/context_f1" },

  { category: "quality", type: "langevals/sentiment" },
  { category: "quality", type: "lingua/language_detection" },
  { category: "quality", type: "ragas/summarization_score" },
  { category: "quality", type: "langevals/valid_format" },
  { category: "quality", type: "langevals/query_resolution" },
  { category: "quality", type: "ragas/sql_query_equivalence" },

  { category: "safety", type: "presidio/pii_detection" },
  { category: "safety", type: "azure/prompt_injection" },
  { category: "safety", type: "azure/jailbreak" },
  { category: "safety", type: "azure/content_safety" },
  { category: "safety", type: "openai/moderation" },
  { category: "safety", type: "langevals/competitor_blocklist" },
  { category: "safety", type: "langevals/competitor_llm" },
  { category: "safety", type: "langevals/competitor_llm_function_call" },
  { category: "safety", type: "langevals/off_topic" },
];

// Local-only spec (not run in CI — config throws without the gitignored
// auth.json). Override for your local setup; defaults match the rest of the
// e2e suite (dev server on :5560). PROJECT_SLUG must point at a local project
// with evaluators enabled.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5560";
const PROJECT_SLUG = process.env.E2E_PROJECT_SLUG ?? "testlangwatchai-bMbT1U";
const RUN_ID = Date.now().toString(36);

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 60000,
});

test.describe.configure({ mode: "serial" });

test.describe("create every UI-exposed evaluator with defaults", () => {
  for (const { category, type } of UI_EVALUATORS) {
    test(`creates ${type}`, async ({ page }) => {
      test.setTimeout(120000);

      const safeType = type.replace(/\//g, "-");
      const evaluatorName = `${AVAILABLE_EVALUATORS[type].name} (e2e ${RUN_ID})`;

      // 1. Open the category selector drawer via deeplink.
      await page.goto(
        `${BASE_URL}/${PROJECT_SLUG}/evaluations?drawer.open=evaluatorCategorySelector`,
      );
      await page
        .getByTestId(`evaluator-category-${category}`)
        .click({ timeout: 30000 });

      // 2. Locate the evaluator-type card. Skip if disabled (missing env keys).
      const typeCard = page.getByTestId(`evaluator-type-${safeType}`);
      await expect(typeCard).toBeVisible({ timeout: 15000 });
      const disabled = await typeCard.getAttribute("data-disabled");
      test.skip(disabled === "true", `${type} disabled (missing env keys)`);

      await typeCard.click();

      // 3. Fill the required name, accept all schema defaults, save.
      const nameInput = page.getByTestId("evaluator-name-input");
      await expect(nameInput).toBeVisible({ timeout: 15000 });
      await nameInput.fill(evaluatorName);

      const saveButton = page.getByTestId("save-evaluator-button");
      await expect(saveButton).toBeVisible();
      await saveButton.click();

      // 4. Success signal: save button disappears (drawer closes / navigates away).
      await expect(saveButton).toBeHidden({ timeout: 30000 });

      // 5. Verify the evaluator persisted and renders in the listing page.
      await page.goto(`${BASE_URL}/${PROJECT_SLUG}/evaluators`);
      await expect(page.getByText(evaluatorName).first()).toBeVisible({
        timeout: 15000,
      });
    });
  }
});
