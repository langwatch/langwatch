/**
 * The fakes the judged-hydration suites share.
 *
 * Its own module because the two suites — what a statement costs, and what a
 * cell holds when the judge did not answer — read the same classifier fake and
 * the same one-conversation source, and a fake defined twice is a fake that
 * drifts.
 *
 * @see ./evaluate.unit.test.ts
 * @see ./evaluateSkips.unit.test.ts
 */

import type {
  InstantEvalClassifier,
  InstantEvalClassifyRequest,
  InstantEvalJudgement,
  InstantEvalVerdict,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import { INSTANT_EVAL_PRICING } from "~/server/app-layer/instant-evals/classifier/pricing";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";
import type { InstantEvalHydrationSupport } from "../hydration/contract";
import type { LangWatchQLAppFunctionCall } from "../plan";
import { sourceOf, trace } from "./hydrateFixtures";

export const THREAD = "conversation-1";

/** A classifier that records its requests and answers from a fixed table. */
export function classifierAnswering(
  answer: (request: InstantEvalClassifyRequest) => InstantEvalJudgement,
): InstantEvalClassifier & { requests: InstantEvalClassifyRequest[] } {
  const requests: InstantEvalClassifyRequest[] = [];
  return {
    requests,
    limits: INSTANT_EVAL_CLASSIFIER_LIMITS,
    pricing: INSTANT_EVAL_PRICING,
    async classify(request) {
      requests.push(request);
      return answer(request);
    },
  };
}

export function judged(verdicts: InstantEvalVerdict[]): InstantEvalJudgement {
  return { verdicts, inputTokens: 100, isTextTruncated: false };
}

export function support(
  classifier: InstantEvalClassifier,
): InstantEvalHydrationSupport {
  return { classifier, maxConcurrency: 4, queryTokenBudget: 4_000_000 };
}

export const evalOverConversation = ({
  column,
  options,
  fn = "eval",
}: {
  column: string;
  options: LangWatchQLAppFunctionCall["options"];
  fn?: string;
}): LangWatchQLAppFunctionCall => ({
  column,
  function: fn,
  options,
  source: { function: "conversation", options: [] },
});

export const threadSource = () =>
  sourceOf({
    threadTraces: [
      trace({
        traceId: "trace-1",
        threadKey: THREAD,
        input: "my order never arrived",
        output: "I am sorry about that",
      }),
    ],
  });
