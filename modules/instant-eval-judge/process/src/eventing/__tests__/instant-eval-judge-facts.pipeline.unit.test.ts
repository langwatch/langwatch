/**
 * @vitest-environment node
 * The judge folds billing's usage-billed fact through its own peer subscriber, so it calls no
 * peer (ADR-174 decision 13); project placement is read through shares (R40).
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { USAGE_BILLING_CHANGED_EVENT_TYPE } from "@langwatch/enterprise-billing-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import {
  MemoryInstantEvalJudgeSpendRepository,
  MemoryInstantEvalJudgeUsageBillingRepository,
} from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeFactsService } from "../../services/instant-eval-judge-facts.service.ts";
import { buildInstantEvalJudgeFactsPipeline } from "../instant-eval-judge-facts.pipeline.ts";
import { judgeFactOwner } from "./instant-eval-judge-facts.fixture.ts";

const ORGANIZATION_ID = "organization-1";

function harness() {
  const facts = InstantEvalJudgeFactsService.create({
    repositories: {
      usageBilling: MemoryInstantEvalJudgeUsageBillingRepository.create(),
      spend: MemoryInstantEvalJudgeSpendRepository.create(),
    },
  });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const append = judgeFactOwner(eventing);
  eventing.register(buildInstantEvalJudgeFactsPipeline({ facts }));
  return { append, facts };
}

describe("given the judge's facts pipeline beside billing's facts", () => {
  describe("when billing records whether the meter bills an organization", () => {
    it("folds the newest answer, whatever order the facts arrive in", async () => {
      const { append, facts } = harness();
      const fact = (occurredAt: number, usageBilled: boolean, fromCatchUp: boolean) => ({
        type: USAGE_BILLING_CHANGED_EVENT_TYPE,
        data: {
          tenantId: ORGANIZATION_ID,
          organizationId: ORGANIZATION_ID,
          occurredAt,
          usageBilled,
          fromCatchUp,
        },
      });

      const folded = vi.spyOn(facts, "usageBillingChanged");

      await append(fact(100, false, false), "event-real");
      await append(fact(70, true, true), "event-catch-up");
      await vi.waitFor(() => expect(folded).toHaveBeenCalledTimes(2));

      await expect(facts.getUsageBilling({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
        outcome: "folded",
        fact: { usageBilled: false, occurredAtMs: 100, fromCatchUp: false },
      });
    });
  });
});
