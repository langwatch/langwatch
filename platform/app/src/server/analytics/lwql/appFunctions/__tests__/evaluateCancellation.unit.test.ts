/**
 * A cancelled judging keeps what it judged.
 *
 * A signal that fires part way through a page used to throw out of the judge
 * loop, and with it every verdict and every token already paid for. What is
 * pinned here is the other contract: the units that answered are in the
 * result and its usage, the units never asked are named, and nothing after
 * the abort is sent.
 *
 * @see ../hydration/evaluate.ts
 * @see specs/lwql/eval-functions.feature
 */

import { describe, expect, it } from "vitest";
import type {
  InstantEvalClassifier,
  InstantEvalClassifyRequest,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import { INSTANT_EVAL_PRICING } from "~/server/app-layer/instant-evals/classifier/pricing";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";
import type { LangWatchQLAppFunctionCall } from "../plan";
import { hydrate, sourceOf, trace } from "./hydrateFixtures";

const CALLS: LangWatchQLAppFunctionCall[] = [
  {
    column: "annoyed",
    function: "eval",
    options: ["The customer sounds annoyed"],
    source: { function: "trace_json", options: [] },
  },
];

const COLUMNS = [{ name: "annoyed", type: "Nullable(String)" }];

/**
 * A classifier that answers its first request and aborts the signal while
 * answering the second, the way a cancel lands between two units.
 */
function classifierAbortingOnSecond(
  controller: AbortController,
): InstantEvalClassifier & {
  requests: InstantEvalClassifyRequest[];
} {
  const requests: InstantEvalClassifyRequest[] = [];
  return {
    requests,
    limits: INSTANT_EVAL_CLASSIFIER_LIMITS,
    pricing: INSTANT_EVAL_PRICING,
    async classify(request, signal) {
      requests.push(request);
      if (requests.length === 1) {
        return {
          verdicts: [{ questionId: "annoyed", probability: 0.9 }],
          inputTokens: 100,
          isTextTruncated: false,
        };
      }
      controller.abort();
      throw signal?.reason ?? new DOMException("aborted", "AbortError");
    },
  };
}

describe("given a judged query the caller cancels part way", () => {
  describe("when the signal fires after one unit has answered", () => {
    /** @scenario "A cancelled query keeps the judgements it made" */
    it("keeps the answered verdict and its usage, and names the unjudged rows", async () => {
      const controller = new AbortController();
      const classifier = classifierAbortingOnSecond(controller);

      const result = await hydrate({
        calls: CALLS,
        columns: COLUMNS,
        rows: [{ annoyed: "t1" }, { annoyed: "t2" }, { annoyed: "t3" }],
        traceSource: sourceOf({
          traces: [
            trace({ traceId: "t1" }),
            trace({ traceId: "t2" }),
            trace({ traceId: "t3" }),
          ],
        }),
        instantEvals: {
          classifier,
          maxConcurrency: 1,
          queryTokenBudget: 1_000_000,
        },
        signal: controller.signal,
      });

      expect(result.rows[0]?.annoyed).toBe(0.9);
      expect(result.rows[1]?.annoyed).toBeNull();
      expect(result.rows[2]?.annoyed).toBeNull();
      expect(result.cancellation).toEqual({ unjudgedRows: [1, 2] });
      expect(result.evalUsage).toMatchObject({ requests: 1, inputTokens: 100 });
      // Nothing after the abort is sent: the third text never reached the
      // classifier, which is what "stops judging" means.
      expect(classifier.requests).toHaveLength(2);
      // Rows the abort reached are not unresolved keys: they found their
      // text and were never asked, which is a different fact.
      expect(result.unresolvedKeys).toEqual([]);
    });
  });
});
