/**
 * @vitest-environment node
 * The judge's priced fact and the spend row its subscriber writes from it (ADR-174 decision 13):
 * one row per request, never rewritten.
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { InstantEvalJudgeSpendPricedEventData } from "@langwatch/instant-eval-judge-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  MemoryInstantEvalJudgeProjectRepository,
  MemoryInstantEvalJudgeRepositories,
} from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { instantEvalJudgeSpendPricedOf } from "../../rules/instant-eval-judge-spend.rules.ts";
import { InstantEvalJudgeFactsService } from "../../services/instant-eval-judge-facts.service.ts";
import { InstantEvalJudgeService } from "../../services/instant-eval-judge.service.ts";
import { RecordInstantEvalJudgeSpendPricedCommand } from "../instant-eval-judge-spend.commands.ts";
import { buildInstantEvalJudgeSpendPipeline } from "../instant-eval-judge-spend.pipeline.ts";

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const NOW = 1_760_000_000_000;

function harness() {
  const repositories = {
    ...MemoryInstantEvalJudgeRepositories.create(),
    projects: MemoryInstantEvalJudgeProjectRepository.create({
      rows: new Map([[PROJECT_ID, { organizationId: ORGANIZATION_ID }]]),
    }),
  };
  const facts = InstantEvalJudgeFactsService.create({ repositories });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const registered = eventing.register(buildInstantEvalJudgeSpendPipeline({ facts }));
  const append = (fact: InstantEvalJudgeSpendPricedEventData) =>
    registered.commands.recordSpendPriced.send(fact);
  return { repositories, facts, append };
}

const total = (facts: InstantEvalJudgeFactsService) =>
  facts.getSpendTotal({ organizationId: ORGANIZATION_ID });

describe("given the judge's spend pipeline", () => {
  describe("when a judge call that classified five hundred input tokens finishes", () => {
    /** @scenario "A judge call records one spend row priced for the customer" */
    it("records one spend row with the customer price, and answers that price", async () => {
      const { repositories, facts, append } = harness();
      const judge = InstantEvalJudgeService.create({
        repositories,
        classifier: {
          classify: async () => ({
            verdicts: [{ questionId: "verdict", probability: 0.8 }],
            inputTokens: 500,
            isTextTruncated: false,
          }),
        },
        isCloud: true,
        recordSpendPriced: append,
        mintRequestId: () => "request-1",
        now: () => Temporal.Instant.fromEpochMilliseconds(NOW),
      });

      const answer = await judge.judge({
        projectId: PROJECT_ID,
        text: "Output: hello",
        questions: [{ id: "verdict", kind: "boolean", instructions: "It greets" }],
      });

      const { priceUsd, fact } = instantEvalJudgeSpendPricedOf({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestId: "request-1",
        inputTokens: 500,
        occurredAt: NOW,
      });
      expect(answer).toMatchObject({ outcome: "judged", priceUsd });
      await vi.waitFor(async () =>
        expect((await total(facts)).spendNanoUsd).toBe(BigInt(fact.priceNanoUsd)),
      );
    });
  });

  describe("when one request is priced twice", () => {
    it("keeps one row for it", async () => {
      const { facts, append } = harness();
      const { fact } = instantEvalJudgeSpendPricedOf({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestId: "request-1",
        inputTokens: 500,
        occurredAt: NOW,
      });

      await append(fact);
      await append({ ...fact, occurredAt: NOW + 1 });
      await vi.waitFor(async () => expect((await total(facts)).spendNanoUsd).toBeGreaterThan(0n));

      expect((await total(facts)).spendNanoUsd).toBe(BigInt(fact.priceNanoUsd));
    });
  });
});

describe("the priced fact", () => {
  it("is recorded on the organization's aggregate, keyed by its request", () => {
    const { fact } = instantEvalJudgeSpendPricedOf({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      requestId: "request-1",
      inputTokens: 500,
      occurredAt: NOW,
    });
    const [event] = new RecordInstantEvalJudgeSpendPricedCommand().handle({
      tenantId: ORGANIZATION_ID,
      aggregateId: ORGANIZATION_ID,
      type: "lw.instant_eval_judge.record_spend_priced",
      data: fact,
    } as Parameters<RecordInstantEvalJudgeSpendPricedCommand["handle"]>[0]);

    expect(event).toMatchObject({
      aggregateId: ORGANIZATION_ID,
      type: "lw.instant_eval_judge.spend_priced",
      idempotencyKey: "organization-1:spend-priced:request-1",
      data: { requestId: "request-1", priceNanoUsd: fact.priceNanoUsd },
    });
  });
});
