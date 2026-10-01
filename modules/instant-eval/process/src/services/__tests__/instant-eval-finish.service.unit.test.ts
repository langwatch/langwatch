/**
 * Finishing a run: what it cost, recorded once, and the hold it was accepted
 * under, dropped only after that record landed.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import type { InstantEvalSpendRecord } from "../../rules/instant-eval-spend-outcome.rules.ts";
import { InstantEvalFinishService } from "../instant-eval-finish.service.ts";

const PROJECT_ID = "project-1";
const RUN_ID = "run-1";
const AT = Temporal.Instant.from("2026-09-18T10:00:00Z");

/** The spend spine and the budget, recording what each was told, in order. */
function finishing({ recorderFails = false }: { recorderFails?: boolean } = {}): {
  service: InstantEvalFinishService;
  recorded: InstantEvalSpendRecord[];
  released: { reservationId: string }[];
  order: string[];
} {
  const recorded: InstantEvalSpendRecord[] = [];
  const released: { reservationId: string }[] = [];
  const order: string[] = [];

  return {
    service: InstantEvalFinishService.create({
      spend: {
        recordSpend: async (record) => {
          order.push("spend");
          if (recorderFails) throw new Error("the spend spine is away");
          recorded.push(record);
        },
      },
      budget: {
        release: async ({ reservationId }) => {
          order.push("release");
          released.push({ reservationId });
        },
      },
      pricing: INSTANT_EVAL_PRICING,
      now: () => AT,
    }),
    recorded,
    released,
    order,
  };
}

describe("given a run that judged rows", () => {
  describe("when it finishes", () => {
    /** @scenario "A finished run reports its spend once" */
    it("records what the judge charged and what the customer pays", async () => {
      const { service, recorded } = finishing();

      const spend = await service.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 1_000_000,
        requests: 500,
      });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        inputTokens: 1_000_000,
        requests: 500,
      });
      expect(spend.priceUsd).toBeGreaterThan(spend.costUsd);
    });

    /** @scenario "A hold is released when the run's spend lands" */
    it("drops the hold only after the spend is recorded", async () => {
      const { service, order, released } = finishing();

      await service.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 1_000,
        requests: 10,
      });

      expect(order).toEqual(["spend", "release"]);
      expect(released).toEqual([{ reservationId: RUN_ID }]);
    });
  });

  describe("when the spend cannot be recorded", () => {
    /** @scenario "A spend that cannot be recorded is retried, not dropped" */
    it("raises, so the intent retries onto the same record rather than losing it", async () => {
      const { service, released } = finishing({ recorderFails: true });

      await expect(
        service.finish({
          runId: RUN_ID,
          projectId: PROJECT_ID,
          outcome: "finished",
          inputTokens: 1_000,
          requests: 10,
        }),
      ).rejects.toThrow("the spend spine is away");
      expect(released).toEqual([]);
    });
  });
});

describe("given a run that judged nothing", () => {
  describe("when it finishes", () => {
    /** @scenario "A run that judged nothing reports no spend" */
    it("records no spend, because a row of zero is one a customer has to dismiss", async () => {
      const { service, recorded, released } = finishing();

      const spend = await service.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "cancelled",
        inputTokens: 0,
        requests: 0,
      });

      expect(recorded).toEqual([]);
      expect(spend).toEqual({ costUsd: 0, priceUsd: 0 });
      expect(released).toEqual([{ reservationId: RUN_ID }]);
    });
  });
});
