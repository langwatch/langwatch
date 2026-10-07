/**
 * @vitest-environment node
 * The judge folds project's and billing's facts through its own peer subscribers, so it calls no
 * peer (ADR-174 decision 13). Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { USAGE_BILLING_CHANGED_EVENT_TYPE } from "@langwatch/enterprise-billing-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import {
  MemoryInstantEvalJudgeProjectRepository,
  MemoryInstantEvalJudgeSpendRepository,
  MemoryInstantEvalJudgeUsageBillingRepository,
} from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeFactsService } from "../../services/instant-eval-judge-facts.service.ts";
import { buildInstantEvalJudgeFactsPipeline } from "../instant-eval-judge-facts.pipeline.ts";
import { judgeFactOwner } from "./instant-eval-judge-facts.fixture.ts";

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";

function harness() {
  const projectRows = new Map<string, { organizationId: string; createdAtMs: number }>();
  const projects = MemoryInstantEvalJudgeProjectRepository.create({ rows: projectRows });
  const facts = InstantEvalJudgeFactsService.create({
    repositories: {
      projects,
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
  return { append, facts, projectRows };
}

const created = {
  type: PROJECT_CREATED_EVENT_TYPE,
  data: {
    tenantId: PROJECT_ID,
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    occurredAt: 10,
  },
} as const;

describe("given the judge's facts pipeline beside project's and billing's facts", () => {
  describe("when project records a creation", () => {
    it("learns the project's organization", async () => {
      const { append, facts } = harness();

      await append(created, "event-created");

      await vi.waitFor(async () =>
        expect(await facts.getProjectPlacement({ projectId: PROJECT_ID })).toEqual({
          outcome: "known",
          organizationId: ORGANIZATION_ID,
        }),
      );
    });
  });

  describe("when the same project created fact is folded again", () => {
    /** @scenario "A repeated project created fact leaves one judge row" */
    it("holds one row for that project", async () => {
      const { append, facts, projectRows } = harness();
      await append(created, "event-created");
      await vi.waitFor(async () =>
        expect((await facts.getProjectPlacement({ projectId: PROJECT_ID })).outcome).toBe("known"),
      );

      // A backfill re-run records the same fact under a new event id.
      await append({ ...created, data: { ...created.data, backfilled: true } }, "event-backfill");
      await facts.projectCreated(created.data);

      await vi.waitFor(() => expect(projectRows.size).toBe(1));
      await expect(facts.getProjectPlacement({ projectId: PROJECT_ID })).resolves.toEqual({
        outcome: "known",
        organizationId: ORGANIZATION_ID,
      });
    });
  });

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
