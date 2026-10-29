/**
 * Finishing a run: what it cost, recorded once, and the hold it was accepted
 * under, dropped only after that record landed.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import { INSTANT_EVAL_PRICING } from "@langwatch/instant-eval-judge-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { InstantEvalFinishService } from "../instant-eval-finish.service.ts";
import type { InstantEvalJudgedSpend } from "../instant-eval-judged-spend.service.ts";

const PROJECT_ID = "project-1";
const RUN_ID = "run-1";
const AT = Temporal.Instant.from("2026-09-18T10:00:00Z");

/** The spend spine and the budget, recording what each was told, in order. */
function finishing({ recorderFails = false }: { recorderFails?: boolean } = {}): {
  service: InstantEvalFinishService;
  recorded: InstantEvalJudgedSpend[];
  released: { reservationId: string }[];
  order: string[];
} {
  const recorded: InstantEvalJudgedSpend[] = [];
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

describe("given a routed run", () => {
  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("prices the summed routed cost and hands it to the judge with the tokens", async () => {
    const { service, recorded } = finishing();

    const spend = await service.finish({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      outcome: "finished",
      inputTokens: 1_000_000,
      requests: 10,
      costNanoUsd: 2_000_000_000,
      routedInputTokens: 1_000_000,
    });

    expect(spend.costUsd).toBe(2);
    expect(spend.priceUsd).toBe(2 * INSTANT_EVAL_PRICING.markup);
    expect(recorded[0]).toMatchObject({
      inputTokens: 1_000_000,
      costNanoUsd: 2_000_000_000,
      routedInputTokens: 1_000_000,
    });
  });

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("prices a mixed run's unrouted tokens at the published rate on top of its routed cost", async () => {
    const { service, recorded } = finishing();

    const spend = await service.finish({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      outcome: "finished",
      inputTokens: 1_000_000,
      requests: 10,
      costNanoUsd: 100_000_000,
      routedInputTokens: 500_000,
    });

    expect(spend.costUsd).toBe(0.121);
    expect(recorded[0]).toMatchObject({ costNanoUsd: 100_000_000, routedInputTokens: 500_000 });
  });

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("hands a routed run that cost nothing to the judge as routed, so its tokens bill nothing", async () => {
    const { service, recorded } = finishing();

    const spend = await service.finish({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      outcome: "finished",
      inputTokens: 1_000_000,
      requests: 10,
      costNanoUsd: 0,
      routedInputTokens: 1_000_000,
    });

    expect(spend.costUsd).toBe(0);
    expect(recorded[0]).toMatchObject({ costNanoUsd: 0, routedInputTokens: 1_000_000 });
  });

  /** @scenario "Routed and unrouted tokens are billed separately" */
  it("hands a routed cost that covers no input tokens to the judge, as the run's cost counts it", async () => {
    const { service, recorded } = finishing();

    const spend = await service.finish({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      outcome: "finished",
      inputTokens: 1_000_000,
      requests: 10,
      costNanoUsd: 5_000_000,
      routedInputTokens: 0,
    });

    // $0.005 of output-only routed cost, plus one million unrouted tokens at $0.042.
    expect(spend.costUsd).toBe(0.047);
    expect(recorded[0]).toMatchObject({ costNanoUsd: 5_000_000, routedInputTokens: 0 });
  });

  /** @scenario "A page event without a routed cost still reads and prices from tokens" */
  it("prices the tokens as before when the run carries no routed cost", async () => {
    const { service, recorded } = finishing();

    await service.finish({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      outcome: "finished",
      inputTokens: 1_000_000,
      requests: 10,
    });

    expect(recorded[0]).not.toHaveProperty("costNanoUsd");
  });
});
