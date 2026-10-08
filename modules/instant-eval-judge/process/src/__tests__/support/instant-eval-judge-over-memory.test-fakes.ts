/**
 * The judge's real facts, spend and judge call over memory tables, with a classifier that
 * answers yes. A peer's suite registers the pipelines on its own eventing, so a fact its task
 * records reaches the judge's subscribers as it would in a process.
 */
import type {
  InstantEvalJudgeApi,
  InstantEvalJudgeSpendPricedEventData,
} from "@langwatch/instant-eval-judge-contract";
import { Temporal } from "@langwatch/time";

import { MemoryInstantEvalClassifierChannel } from "../../channels/memory/memory.instant-eval-classifier.channel.ts";
import {
  buildInstantEvalJudgeFactsPipeline,
  type InstantEvalJudgeFactsPipeline,
} from "../../eventing/instant-eval-judge-facts.pipeline.ts";
import {
  buildInstantEvalJudgeSpendPipeline,
  type InstantEvalJudgeSpendPipeline,
} from "../../eventing/instant-eval-judge-spend.pipeline.ts";
import type { InstantEvalJudgeSpendRow } from "../../repositories/instant-eval-judge-spend.repository.ts";
import {
  MemoryInstantEvalJudgeProjectRepository,
  MemoryInstantEvalJudgeSpendRepository,
  MemoryInstantEvalJudgeUsageBillingRepository,
} from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import type { InstantEvalJudgeUsageBillingFact } from "../../rules/instant-eval-judge-usage-billing.rules.ts";
import { InstantEvalJudgeFactsService } from "../../services/instant-eval-judge-facts.service.ts";
import { InstantEvalJudgeService } from "../../services/instant-eval-judge.service.ts";

export type InstantEvalJudgeOverMemory = Readonly<{
  /** The judge call, the run and query record, and the spend catch-up's copy, all real. */
  judges: Pick<InstantEvalJudgeApi, "judge" | "recordSpend" | "copyLedgerSpend">;
  /** The judge's fold of billing's usage-billed fact. */
  factsPipeline: () => InstantEvalJudgeFactsPipeline;
  /** The judge's own priced facts; connect its senders with `connectSpend`. */
  spendPipeline: () => InstantEvalJudgeSpendPipeline;
  connectSpend: (send: (fact: InstantEvalJudgeSpendPricedEventData) => Promise<void>) => void;
  /** The judge's tables, so a suite can count the rows the folds and copies left. */
  rows: Readonly<{
    usageBilling: ReadonlyMap<string, InstantEvalJudgeUsageBillingFact>;
    spend: ReadonlyMap<string, InstantEvalJudgeSpendRow>;
  }>;
  usageBilledOf: (input: { organizationId: string }) => Promise<boolean | "never_folded">;
  spendNanoUsdOf: (input: { organizationId: string }) => Promise<bigint>;
}>;

const OCCURRED_AT = Date.UTC(2026, 9, 7);

/** `placed` stands in for the projects project's and organization's tables hold (R40). */
export function instantEvalJudgeOverMemory({
  placed = [],
}: {
  placed?: readonly Readonly<{ projectId: string; organizationId: string }>[];
} = {}): InstantEvalJudgeOverMemory {
  const projectRows = new Map(
    placed.map(({ projectId, organizationId }) => [projectId, { organizationId }]),
  );
  const usageBillingRows = new Map<string, InstantEvalJudgeUsageBillingFact>();
  const spendRows = new Map<string, InstantEvalJudgeSpendRow>();
  const repositories = {
    projects: MemoryInstantEvalJudgeProjectRepository.create({ rows: projectRows }),
    usageBilling: MemoryInstantEvalJudgeUsageBillingRepository.create({ rows: usageBillingRows }),
    spend: MemoryInstantEvalJudgeSpendRepository.create({ rows: spendRows }),
  };
  const facts = InstantEvalJudgeFactsService.create({ repositories });
  let sendPriced: ((fact: InstantEvalJudgeSpendPricedEventData) => Promise<void>) | undefined;
  const judge = InstantEvalJudgeService.create({
    repositories,
    classifier: MemoryInstantEvalClassifierChannel.create({
      answer: async ({ questions }) => ({
        verdicts: questions.map((question) => ({ questionId: question.id, probability: 1 })),
        inputTokens: 1_000,
        isTextTruncated: false,
      }),
    }),
    isCloud: true,
    recordSpendPriced: async (fact) => {
      if (!sendPriced) throw new Error("connectSpend was not called");
      await sendPriced(fact);
    },
    mintRequestId: () => `instantevaljudge_${spendRows.size + 1}`,
    now: () => Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT),
  });

  return {
    judges: {
      judge: (input) => judge.judge(input),
      recordSpend: (input) => judge.recordSpend(input),
      copyLedgerSpend: (input) => facts.copyLedgerSpend(input),
    },
    factsPipeline: () => buildInstantEvalJudgeFactsPipeline({ facts }),
    spendPipeline: () => buildInstantEvalJudgeSpendPipeline({ facts }),
    connectSpend: (send) => {
      sendPriced = send;
    },
    rows: { usageBilling: usageBillingRows, spend: spendRows },
    usageBilledOf: async ({ organizationId }) => {
      const held = await facts.getUsageBilling({ organizationId });
      return held.outcome === "folded" ? held.fact.usageBilled : "never_folded";
    },
    spendNanoUsdOf: async ({ organizationId }) =>
      (await facts.getSpendTotal({ organizationId })).spendNanoUsd,
  };
}
