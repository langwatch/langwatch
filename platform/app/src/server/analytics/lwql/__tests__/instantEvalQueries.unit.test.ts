/**
 * A judged query end to end through the service: the budget it refuses, the
 * failure it reports, and the cost row it leaves behind.
 *
 * A fake executor and a fake classifier, for the reason the sibling service
 * suite documents: the claims are about what reached each seam, which is an
 * artifact to inspect rather than a call sequence to verify.
 *
 * @see ../lwql.service.ts
 * @see specs/lwql/eval-functions.feature
 */

import { describe, expect, it } from "vitest";

import type {
  InstantEvalClassifier,
  InstantEvalJudgement,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import { INSTANT_EVAL_PRICING } from "~/server/app-layer/instant-evals/classifier/pricing";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";
import type { InstantEvalSpendRecord } from "~/server/app-layer/instant-evals/instant-eval-spend.recorder";
import type { Protections } from "../../../traces/protections";
import { recordingExecutor } from "../executor.testFakes";
import type { LangWatchQLInstantEvalSupport } from "../instantEvalSupport";
import { LangWatchQLService } from "../lwql.service";
import { describeLangWatchQLAppFunctions } from "../schema";

const DATABASE = "analytics";

const PROJECT = {
  id: "project-instant-evals",
  lwqlKey: "sk-lw-instant-evals-unit-test-key",
};

const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

const JUDGED_SQL =
  "SELECT eval(CapturedOutput, 'The answer is an apology') AS annoyed " +
  "FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)";

function classifierAnswering(
  answer: () => Promise<InstantEvalJudgement>,
): InstantEvalClassifier {
  return {
    limits: INSTANT_EVAL_CLASSIFIER_LIMITS,
    pricing: INSTANT_EVAL_PRICING,
    classify: answer,
  };
}

function serviceJudgingWith({
  classifier,
  queryTokenBudget = 4_000_000,
  spends = [],
  rows = [{ annoyed: "the agent said sorry" }],
  reserveFreeBudget = async () => {},
  releaseFreeBudget = async () => {},
}: {
  classifier: InstantEvalClassifier;
  queryTokenBudget?: number;
  spends?: InstantEvalSpendRecord[];
  rows?: Record<string, unknown>[];
  reserveFreeBudget?: LangWatchQLInstantEvalSupport["reserveFreeBudget"];
  releaseFreeBudget?: LangWatchQLInstantEvalSupport["releaseFreeBudget"];
}): LangWatchQLService {
  return new LangWatchQLService({
    executor: recordingExecutor({
      columns: [{ name: "annoyed", type: "Nullable(String)" }],
      rows,
    }),
    database: DATABASE,
    instantEvals: {
      isEnabled: async () => true,
      classifier: () => classifier,
      maxConcurrency: 4,
      queryTokenBudget,
      reserveFreeBudget,
      releaseFreeBudget,
      recordSpend: async (record) => {
        spends.push(record);
      },
    },
  });
}

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "no error was thrown";
}

const run = (service: LangWatchQLService) =>
  service.execute({
    projects: [PROJECT],
    protections: FULLY_PERMITTED,
    sql: JUDGED_SQL,
  });

describe("given a statement that would judge more text than one query may", () => {
  describe("when it is executed", () => {
    /** @scenario "A query whose text volume exceeds the per-query budget is refused" */
    it("refuses it, naming what it would have sent and what is allowed", async () => {
      const service = serviceJudgingWith({
        classifier: classifierAnswering(async () => {
          throw new Error("nothing should have been sent");
        }),
        queryTokenBudget: 1,
      });

      const error = await run(service).catch((thrown: unknown) => thrown);

      expect((error as { code?: unknown }).code).toBe(
        "instant_eval_query_budget_exceeded",
      );
      expect((error as { meta?: Record<string, unknown> }).meta).toMatchObject({
        budget: 1,
      });
      expect(
        (error as { meta?: { estimatedTokens?: number } }).meta
          ?.estimatedTokens,
      ).toBeGreaterThan(1);
    });
  });
});

describe("given an organization that has spent its free Instant Evals budget", () => {
  describe("when a judged statement is executed", () => {
    /** @scenario "At the budget a synchronous judged query is refused" */
    it("refuses it before anything is sent to the classifier", async () => {
      const { InstantEvalFreeBudgetExhaustedError } = await import(
        "~/server/app-layer/instant-evals/errors"
      );
      let classified = 0;
      const service = serviceJudgingWith({
        classifier: classifierAnswering(async () => {
          classified += 1;
          throw new Error("nothing should have been sent");
        }),
        reserveFreeBudget: async () => {
          throw new InstantEvalFreeBudgetExhaustedError({
            spentUsd: 1,
            budgetUsd: 1,
          });
        },
      });

      expect(await codeOf(() => run(service))).toBe(
        "instant_eval_free_budget_exhausted",
      );
      expect(classified).toBe(0);
    });
  });
});

describe("given a classifier that answers nothing at all", () => {
  describe("when a judged statement is executed", () => {
    /** @scenario "A classifier that fails for the whole query is a platform refusal" */
    it("refuses the query rather than answering with a column of nulls", async () => {
      const service = serviceJudgingWith({
        classifier: classifierAnswering(async () => {
          throw new Error("the classifier is unreachable");
        }),
      });

      expect(await codeOf(() => run(service))).toBe(
        "instant_eval_classifier_unavailable",
      );
    });

    it("reports the failure as the provider's rather than the customer's", async () => {
      const service = serviceJudgingWith({
        classifier: classifierAnswering(async () => {
          throw new Error("the classifier is unreachable");
        }),
      });

      const error = await run(service).catch((thrown: unknown) => thrown);
      expect((error as { fault?: unknown }).fault).toBe("provider");
    });
  });
});

describe("given a query that judged some text", () => {
  describe("when it finishes", () => {
    /** @scenario "One spend record is reported per query" */
    it("reports one spend record carrying the tokens, the cost and the price", async () => {
      const spends: InstantEvalSpendRecord[] = [];
      const service = serviceJudgingWith({
        spends,
        rows: [{ annoyed: "one" }, { annoyed: "two" }],
        classifier: classifierAnswering(async () => ({
          verdicts: [{ questionId: "annoyed", probability: 0.5 }],
          inputTokens: 500_000,
          isTextTruncated: false,
        })),
      });

      await run(service);

      expect(spends).toHaveLength(1);
      expect(spends[0]).toMatchObject({
        projectId: PROJECT.id,
        inputTokens: 1_000_000,
        requests: 2,
      });
      expect(spends[0]?.runId).toBeUndefined();
      expect(spends[0]?.occurredAt).toBeInstanceOf(Date);
      expect(spends[0]?.costUsd).toBeCloseTo(
        INSTANT_EVAL_PRICING.usdPerMillionInputTokens,
        10,
      );
      expect(spends[0]?.priceUsd).toBeCloseTo(
        INSTANT_EVAL_PRICING.usdPerMillionInputTokens *
          INSTANT_EVAL_PRICING.markup,
        10,
      );
    });
  });
});

describe("given a query whose judgements were all skipped", () => {
  describe("when it finishes", () => {
    /** @scenario "A query that judged nothing reports no spend" */
    it("reports no spend", async () => {
      const spends: InstantEvalSpendRecord[] = [];
      const service = serviceJudgingWith({
        spends,
        // The judged column carries no text, so nothing is ever classified.
        rows: [{ annoyed: null }],
        classifier: classifierAnswering(async () => {
          throw new Error("nothing should have been sent");
        }),
      });

      const result = await run(service);

      expect(spends).toEqual([]);
      expect(result.rows).toEqual([{ annoyed: null }]);
      expect(result.diagnostics.map((entry) => entry.code)).toEqual([]);
    });
  });
});

describe("given a project the feature is not open to", () => {
  describe("when the schema is described", () => {
    /** @scenario "The schema publishes eval functions as unavailable while they are gated" */
    it("lists every eval function as unavailable, leaving the rest alone", () => {
      const functions = describeLangWatchQLAppFunctions({
        database: DATABASE,
        protections: FULLY_PERMITTED,
        instantEvalsEnabled: false,
      });

      const evals = functions.filter((entry) => entry.kind === "eval");
      expect(evals.length).toBeGreaterThan(0);
      expect(evals.every((entry) => !entry.available)).toBe(true);
      expect(
        functions
          .filter((entry) => entry.kind === "extraction")
          .every((entry) => entry.available),
      ).toBe(true);
    });

    it("lists them as available once the feature is open", () => {
      const functions = describeLangWatchQLAppFunctions({
        database: DATABASE,
        protections: FULLY_PERMITTED,
        instantEvalsEnabled: true,
      });

      expect(
        functions
          .filter((entry) => entry.kind === "eval")
          .every((entry) => entry.available),
      ).toBe(true);
    });
  });
});

describe("given a statement that calls no eval function", () => {
  describe("when it is executed", () => {
    /** @scenario "A statement that judges nothing resolves no gate and builds no classifier" */
    it("resolves neither the project gate nor the classifier", async () => {
      // The gate is a project read plus a flag evaluation, and the classifier
      // is a connection pool to a third party. Almost no statement judges
      // anything, so a query that names none of these functions must pay for
      // neither.
      let gateReads = 0;
      const service = new LangWatchQLService({
        executor: recordingExecutor({
          columns: [{ name: "value", type: "UInt64" }],
          rows: [{ value: 1 }],
        }),
        database: DATABASE,
        instantEvals: {
          isEnabled: async () => {
            gateReads += 1;
            return true;
          },
          reserveFreeBudget: async () => {},
          releaseFreeBudget: async () => {},
          classifier: () => {
            throw new Error("a statement that judges nothing needs no judge");
          },
          maxConcurrency: 4,
          queryTokenBudget: 4_000_000,
          recordSpend: async () => {},
        },
      });

      await service.execute({
        projects: [PROJECT],
        protections: FULLY_PERMITTED,
        sql:
          "SELECT count() AS value FROM analytics.traces " +
          "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)",
      });

      expect(gateReads).toBe(0);
    });
  });
});

describe("given a free organization under its budget", () => {
  describe("when a judged statement is executed", () => {
    /** @scenario "A judged query holds its ceiling while it judges" */
    it("holds the price of the whole query token budget first and lets it go once the spend is recorded", async () => {
      const events: string[] = [];
      const holds: { reservationId: string; priceUsd: number }[] = [];
      const spends: InstantEvalSpendRecord[] = [];
      const service = serviceJudgingWith({
        spends,
        queryTokenBudget: 1_000_000,
        classifier: classifierAnswering(async () => {
          events.push("judged");
          return {
            verdicts: [{ questionId: "annoyed", probability: 0.5 }],
            inputTokens: 500,
            isTextTruncated: false,
          };
        }),
        reserveFreeBudget: async ({ reservationId, priceUsd }) => {
          events.push("held");
          holds.push({ reservationId, priceUsd });
        },
        releaseFreeBudget: async ({ reservationId }) => {
          events.push(`released ${reservationId === holds[0]?.reservationId}`);
        },
      });

      await run(service);

      expect(events).toEqual(["held", "judged", "released true"]);
      expect(holds[0]?.priceUsd).toBeCloseTo(
        (1_000_000 / 1_000_000) *
          INSTANT_EVAL_PRICING.usdPerMillionInputTokens *
          INSTANT_EVAL_PRICING.markup,
        9,
      );
      expect(spends).toHaveLength(1);
    });
  });
});

describe("given a statement whose eval calls take longer than the database read", () => {
  describe("when the query answers", () => {
    /** @scenario "A judged query reports the time its judging took" */
    it("reports an elapsed time that covers the judging", async () => {
      const service = serviceJudgingWith({
        classifier: classifierAnswering(async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return {
            verdicts: [{ questionId: "annoyed", probability: 0.5 }],
            inputTokens: 500,
            isTextTruncated: false,
          };
        }),
      });

      const result = await run(service);

      expect(result.statistics.elapsedMs).toBeGreaterThanOrEqual(60);
    });
  });
});
