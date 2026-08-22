/**
 * Seeds the evaluations workbench the prompt-optimization scenarios run
 * against: a support-bot prompt, an inline dataset, and (per variant) a
 * mapped evaluator — all through the same REST surface any integration uses,
 * so a passing seed also proves the workbench-state endpoints work.
 *
 * The baseline prompt deliberately knows none of Brightcart's policy facts
 * while the golden answers state them, so roughly the last third of the rows
 * fail an answer-match evaluator until the prompt learns the policies. That
 * is the improvement the loop scenarios expect Langy to find.
 *
 * No baseline run is seeded: the skill's own first step is a scoped run, the
 * scenarios grade that behavior, and a pre-seeded run would cost model calls
 * per suite run without making any scenario more deterministic.
 *
 * Slugs carry a minute stamp so a re-run within the minute reuses the same
 * experiment and a later run seeds a fresh one (same reasoning as the
 * dogfood trace fixtures).
 */

import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";

const RUN_STAMP = String(Math.floor(Date.now() / 60_000));

async function api({
  method,
  path,
  body,
}: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${LW_BASE_URL}${path}`, {
        method,
        headers: {
          "X-Auth-Token": LANGWATCH_API_KEY,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    return res.json();
  }
  throw lastError;
}

/** Rows a support bot for the Brightcart webshop would really get. */
const FREE_TEXT_ROWS: Array<{ input: string; expected: string }> = [
  {
    input: "hey where is my order #4521 its been 2 weeks",
    expected:
      "Apologize for the wait, ask for the order confirmation email, and share the tracking link from it. Orders ship within 2 business days, so 2 weeks means the carrier lost it and we reship for free.",
  },
  {
    input: "can i return these shoes? they don't fit",
    expected:
      "Yes. Returns are free within 30 days of delivery. Start from the Returns page with the order number and a prepaid label is emailed.",
  },
  {
    input: "refund pls, package arrived smashed",
    expected:
      "Apologize, no return needed for damaged items: a photo of the damage is enough, and the refund lands in 5 to 10 business days on the original payment method.",
  },
  {
    input: "do you ship to portugal??",
    expected:
      "Yes, Brightcart ships to all EU countries. Shipping is free over 50 euros, otherwise 4.99.",
  },
  {
    input: "your checkout keeps erroring when i enter my card",
    expected:
      "Apologize, suggest retrying with another browser or the saved-card option, and offer to send a payment link by email if it still fails.",
  },
  {
    input: "how long do refunds take",
    expected:
      "Refunds take 5 to 10 business days and always go back to the original payment method.",
  },
  {
    input: "i ordered the blue one but got the black one",
    expected:
      "Apologize for the mixup. We ship the correct color right away with free express shipping and email a prepaid label for the wrong item.",
  },
  {
    input: "is there a student discount",
    expected:
      "No student discount, but the newsletter gives 10 percent off the first order.",
  },
  {
    input: "cancel my order NOW, i ordered by mistake",
    expected:
      "Orders can be cancelled within 1 hour of placing them from the account page. After that they ship, and the free 30-day return covers it.",
  },
  {
    input: "what's your phone number, i hate email",
    expected:
      "Support is chat and email only, no phone line. Chat answers within a few minutes on business days.",
  },
  {
    input: "the discount code SUMMER10 doesn't work",
    expected:
      "SUMMER10 expired at the end of summer. The newsletter code or current promotions on the homepage still apply, and codes never stack.",
  },
  {
    input: "do i pay customs on my order to switzerland",
    expected:
      "Switzerland is outside the EU, so customs fees can apply and are the customer's responsibility. EU orders never pay customs.",
  },
  {
    input: "my tracking says delivered but nothing arrived",
    expected:
      "Ask them to check with neighbors and the mail room first; if nothing shows up within 2 days we reship for free or refund, their choice.",
  },
  {
    input: "can i change the delivery address? i moved",
    expected:
      "The address can be changed until the order ships. After shipping, the carrier's redirect service is the only option, and support can request it.",
  },
  {
    input: "why was i charged twice???",
    expected:
      "One of the two is a pending authorization that the bank drops within 3 business days; only one charge settles. If both settle, support refunds the duplicate immediately.",
  },
  {
    input: "loyal customer here, 6 orders this year. any perks?",
    expected:
      "Thank them; after 5 orders the account is automatically upgraded to free express shipping on every order.",
  },
  {
    input: "the sweater shrank after one wash, this is not ok",
    expected:
      "Apologize, quality issues are covered for 90 days: a photo is enough for a replacement or refund, their choice.",
  },
  {
    input: "do you have gift wrapping",
    expected:
      "Yes, gift wrapping is 2.99 per item and can be added on the cart page, with a free personal note.",
  },
  {
    input: "i want to buy 40 units for my company, bulk price?",
    expected:
      "Orders over 20 units go through business sales: share the business email from the Contact page and they quote within one business day.",
  },
  {
    input: "u guys are a scam, im calling my bank",
    expected:
      "Stay calm and apologize, ask for the order number to fix the actual problem, and never argue with the chargeback threat.",
  },
];

const LABEL_ROWS: Array<{ input: string; expected: string }> = [
  { input: "where is my package, ordered last monday", expected: "shipping" },
  { input: "these jeans don't fit, want my money back", expected: "refund" },
  { input: "checkout page crashes on my phone", expected: "technical" },
  { input: "do you deliver to austria", expected: "shipping" },
  { input: "got charged twice for one order", expected: "billing" },
  { input: "my discount code is not working", expected: "billing" },
  { input: "arrived broken, glass everywhere", expected: "refund" },
  { input: "how do i reset my password", expected: "technical" },
  { input: "wrong size arrived, need an exchange", expected: "exchange" },
  { input: "is the winter coat coming back in stock", expected: "product" },
  { input: "cancel order 8841 please", expected: "cancellation" },
  { input: "does the blender come with a warranty", expected: "product" },
  { input: "package says delivered, mailbox empty", expected: "shipping" },
  { input: "i want a different color instead", expected: "exchange" },
  { input: "why is there an extra 4.99 on my invoice", expected: "billing" },
  { input: "app logs me out every time", expected: "technical" },
  { input: "returning a gift without a receipt", expected: "refund" },
  { input: "when will my backorder ship", expected: "shipping" },
  { input: "the fabric feels nothing like the photos", expected: "refund" },
  {
    input: "can i add an item to an order i just placed",
    expected: "cancellation",
  },
];

const SUPPORT_PROMPT =
  "You are the customer support assistant for Brightcart, a European webshop for clothing and home goods. Reply briefly, politely and helpfully to customer emails.";

const CLASSIFIER_PROMPT =
  "You classify Brightcart customer support emails into a single category and answer with only the category word.";

export interface SeededWorkbench {
  experimentSlug: string;
  experimentId: string;
  datasetId: string;
  baselineTargetId: string;
  promptId: string;
  version: number;
}

export type GoldenStyle = "free-text" | "label" | "none";

/**
 * Builds and saves the experiment. Variants:
 * - rows: 0 seeds the empty-dataset bootstrap case; 20 is the loop default;
 *   40 crosses the skill's ask-before-spending threshold.
 * - goldenStyle: "free-text" pairs with llm_answer_match, "label" with
 *   exact_match, "none" seeds inputs only (the comparison case).
 * - withEvaluator: whether the llm_answer_match evaluator is pre-wired
 *   (bootstrap scenarios seed without it).
 * - withContexts: adds a contexts column (the faithfulness case).
 */
export async function seedOptimizationWorkbench({
  name,
  rows,
  goldenStyle,
  withEvaluator,
  withContexts = false,
}: {
  name: string;
  rows: number;
  goldenStyle: GoldenStyle;
  withEvaluator: boolean;
  withContexts?: boolean;
}): Promise<SeededWorkbench> {
  const handle = `${name}-${RUN_STAMP}`;
  const isLabel = goldenStyle === "label";
  const promptRes = await api({
    method: "POST",
    path: "/api/prompts",
    body: {
      handle,
      prompt: isLabel ? CLASSIFIER_PROMPT : SUPPORT_PROMPT,
    },
  });
  const promptId: string = promptRes.id;

  const datasetId = "dataset-seed";
  const targetId = "target-baseline";
  const source = isLabel ? LABEL_ROWS : FREE_TEXT_ROWS;
  const picked = Array.from(
    { length: rows },
    (_, i) => source[i % source.length]!,
  );

  const columns = [
    { id: "input", name: "input", type: "string" },
    ...(goldenStyle === "none"
      ? []
      : [{ id: "expected_output", name: "expected_output", type: "string" }]),
    ...(withContexts
      ? [{ id: "contexts", name: "contexts", type: "list" }]
      : []),
  ];
  const records: Record<string, string[]> = {
    input: picked.map((row, i) =>
      i >= source.length ? `${row.input} (case ${i})` : row.input,
    ),
  };
  if (goldenStyle !== "none") {
    records.expected_output = picked.map((row) => row.expected);
  }
  if (withContexts) {
    records.contexts = picked.map(
      (row) => `Brightcart policy notes relevant to: ${row.input}`,
    );
  }

  const datasetField = (field: string) => ({
    type: "source" as const,
    source: "dataset" as const,
    sourceId: datasetId,
    sourceField: field,
  });

  const evaluators = withEvaluator
    ? [
        {
          id: "evaluator-answer-match",
          evaluatorType: "langevals/llm_answer_match",
          inputs: [
            { identifier: "input", type: "str" },
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          mappings: {
            [datasetId]: {
              [targetId]: {
                input: datasetField("input"),
                output: {
                  type: "source" as const,
                  source: "target" as const,
                  sourceId: targetId,
                  sourceField: "output",
                },
                expected_output: datasetField("expected_output"),
              },
            },
          },
        },
      ]
    : [];

  const state = {
    name,
    datasets: [
      {
        id: datasetId,
        name: `${name} dataset`,
        type: "inline",
        inline: { columns, records },
        columns,
      },
    ],
    activeDatasetId: datasetId,
    evaluators,
    targets: [
      {
        id: targetId,
        type: "prompt",
        promptId,
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          [datasetId]: { input: datasetField("input") },
        },
      },
    ],
  };

  const created = await api({
    method: "POST",
    path: "/api/experiments",
    body: { name: `${name}-${RUN_STAMP}`, state },
  });
  return {
    experimentSlug: created.slug,
    experimentId: created.id,
    datasetId,
    baselineTargetId: targetId,
    promptId,
    version: created.version,
  };
}

/** Layer-2 read: the saved workbench state, straight from the REST surface. */
export async function getWorkbenchState(slug: string): Promise<{
  id: string;
  slug: string;
  name: string;
  version: number;
  state: {
    datasets: Array<{
      id: string;
      inline?: { records: Record<string, string[]> };
    }>;
    targets: Array<{
      id: string;
      type: string;
      promptId?: string;
      localPromptConfig?: unknown;
      comparison?: { variants: string[]; hasGoldenAnswer?: boolean };
      mappings: Record<string, Record<string, unknown>>;
    }>;
    evaluators: Array<{
      id: string;
      evaluatorType: string;
      mappings: Record<string, Record<string, Record<string, unknown>>>;
    }>;
  };
}> {
  return api({
    method: "GET",
    path: `/api/experiments/${slug}/workbench-state`,
  });
}

/** Layer-2 read: the runs recorded for an experiment, newest first. */
export async function listExperimentRuns(
  slug: string,
): Promise<Array<{ runId: string; status?: string }>> {
  const result = await api({
    method: "GET",
    path: `/api/experiments/runs?experimentSlug=${encodeURIComponent(slug)}&pageSize=50`,
  });
  return Array.isArray(result?.runs) ? result.runs : [];
}
