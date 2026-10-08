/**
 * @vitest-environment node
 * Gateway writes the ledger row the meter reads from the Instant Evals judge's priced fact,
 * through its own peer subscriber (ADR-174 decision 13). A repeat under the same request id is
 * the same confirm, which the spend spine keeps once.
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { GatewayPricedSpend, GatewayPricedSpendResult } from "@langwatch/gateway-contract";
import {
  INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE,
  INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION,
  INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
  INSTANT_EVAL_REQUEST_TYPE,
  INSTANT_EVAL_SPEND_MODEL,
  type InstantEvalJudgeSpendPricedEventData,
  instantEvalJudgeSpendPricedEventDataSchema,
} from "@langwatch/instant-eval-judge-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { pricedSpendCommandData } from "../../rules/gateway-spend-command.rules.ts";
import { GatewayInstantEvalJudgeSpendService } from "../../services/gateway-instant-eval-judge-spend.service.ts";
import { buildGatewayInstantEvalJudgeSpendPipeline } from "../gateway-instant-eval-judge-spend.pipeline.ts";
import { ConfirmSpendCommand } from "../gateway-spend.intent.ts";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";
const TEAM_ID = "team-1";
const OCCURRED_AT = Date.UTC(2026, 9, 7);

/** The judge leaf's pipeline as its contract names the fact. */
function judgeStandIn() {
  return definePipeline({
    name: "instant_eval_judge_stand_in",
    aggregate: defineAggregate({ type: INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE),
        data: instantEvalJudgeSpendPricedEventDataSchema,
      }),
    ])
    .build();
}

/** One judge call priced at ten cents, as the leaf appends it. */
function pricedFact(): InstantEvalJudgeSpendPricedEventData {
  return {
    tenantId: ORGANIZATION_ID,
    occurredAt: OCCURRED_AT,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    requestId: "instantevaljudge_project-1:evaluation-1:execution",
    model: INSTANT_EVAL_SPEND_MODEL,
    rateVersion: "instant_eval@0.042x1.3",
    inputTokens: 1_000,
    priceNanoUsd: 100_000_000,
    costNanoUsd: 76_923_077,
  };
}

function projectWithTeam(): ProjectWithTeam {
  return {
    id: PROJECT_ID,
    team: { id: TEAM_ID, organizationId: ORGANIZATION_ID },
  } as ProjectWithTeam;
}

function harness({
  project = projectWithTeam(),
  result = { status: "recorded" },
}: {
  project?: ProjectWithTeam | null;
  result?: GatewayPricedSpendResult;
} = {}) {
  const recorded: GatewayPricedSpend[] = [];
  const logger = { error: vi.fn() };
  const spend = GatewayInstantEvalJudgeSpendService.create({
    projects: { findWithTeam: async (id) => (id === PROJECT_ID ? project : null) },
    recordPricedSpend: async (input) => {
      recorded.push(input);
      return result;
    },
    logger,
  });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const judge = eventing.register(judgeStandIn());
  eventing.register(buildGatewayInstantEvalJudgeSpendPipeline({ spend }));
  const append = (data: InstantEvalJudgeSpendPricedEventData, id: string) =>
    judge.service.storeEvents(
      [
        {
          id,
          aggregateId: data.organizationId,
          aggregateType: INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE,
          tenantId: createTenantId(data.tenantId),
          type: INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
          version: INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION,
          createdAt: data.occurredAt,
          occurredAt: data.occurredAt,
          data,
        },
      ],
      { tenantId: createTenantId(data.tenantId) },
    );
  return { eventing, append, recorded, logger, spend };
}

/** The spend spine's own key for a confirm: the one its event store keeps once. */
async function confirmKeyOf(input: GatewayPricedSpend): Promise<string | undefined> {
  const data = pricedSpendCommandData(input) as Parameters<
    ConfirmSpendCommand["handle"]
  >[0]["data"];
  const [event] = await new ConfirmSpendCommand().handle({
    tenantId: createTenantId(input.projectId),
    aggregateId: input.requestId,
    type: ConfirmSpendCommand.schema.type,
    data,
  } as Parameters<ConfirmSpendCommand["handle"]>[0]);
  return event?.idempotencyKey;
}

describe("given gateway's Instant Evals judge spend pipeline beside the judge's priced fact", () => {
  describe("when the judge records a priced call", () => {
    it("writes one confirmed ledger row at the customer price under the judged project and its team", async () => {
      const { eventing, append, recorded } = harness();

      await append(pricedFact(), "evt-priced-1");
      await vi.waitFor(() => expect(recorded).toHaveLength(1));

      expect(recorded[0]).toEqual({
        requestId: "instantevaljudge_project-1:evaluation-1:execution",
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
        teamId: TEAM_ID,
        requestType: INSTANT_EVAL_REQUEST_TYPE,
        model: INSTANT_EVAL_SPEND_MODEL,
        rateVersion: "instant_eval@0.042x1.3",
        inputTokens: 1_000,
        costNanoUsd: 100_000_000,
        metadata: JSON.stringify({ instant_eval: { cost_usd: 0.076923077, requests: 1 } }),
        occurredAt: OCCURRED_AT,
      });
      await eventing.close();
    });
  });

  describe("when the judge records a run's priced spend", () => {
    /** @scenario "A run's ledger row is written from the judge's priced record" */
    /** @scenario "The record is billed against the project's organization and team" */
    it("writes the run's row under the project's organization and team, naming the run", async () => {
      const { eventing, append, recorded } = harness();
      const runFact = {
        ...pricedFact(),
        requestId: "instanteval_run-1",
        inputTokens: 2_000,
        requests: 40,
        runId: "run-1",
      };

      await append(runFact, "evt-run-priced");
      await vi.waitFor(() => expect(recorded).toHaveLength(1));

      expect(recorded[0]).toMatchObject({
        requestId: "instanteval_run-1",
        organizationId: ORGANIZATION_ID,
        teamId: TEAM_ID,
        requestType: INSTANT_EVAL_REQUEST_TYPE,
        model: INSTANT_EVAL_SPEND_MODEL,
        inputTokens: 2_000,
        costNanoUsd: runFact.priceNanoUsd,
      });
      expect(recorded[0]).not.toHaveProperty("virtualKeyId");
      expect(JSON.parse(recorded[0]?.metadata ?? "{}")).toEqual({
        instant_eval: { cost_usd: 0.076923077, requests: 40, run_id: "run-1" },
      });
      await eventing.close();
    });
  });

  describe("when a second priced event with a new event id carries the same request id", () => {
    it("sends the same confirm twice, which the spend spine keeps as one row", async () => {
      const { eventing, append, recorded } = harness();

      await append(pricedFact(), "evt-priced-1");
      await append({ ...pricedFact(), occurredAt: OCCURRED_AT + 1_000 }, "evt-priced-2");
      await vi.waitFor(() => expect(recorded).toHaveLength(2));

      expect(recorded[1]?.requestId).toBe(recorded[0]?.requestId);
      const [first, second] = await Promise.all(recorded.map(confirmKeyOf));
      expect(first).toBeDefined();
      expect(second).toBe(first);
      await eventing.close();
    });
  });
});

describe("given a priced fact the gateway cannot place", () => {
  describe("when its project no longer exists", () => {
    it("logs the request and writes nothing, since a retry cannot find the team either", async () => {
      const { spend, recorded, logger } = harness({ project: null });

      await spend.recordJudgeSpend({ fact: pricedFact() });

      expect(recorded).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          requestId: pricedFact().requestId,
          priceNanoUsd: 100_000_000,
        }),
        expect.stringContaining("Instant Evals judge spend"),
      );
    });
  });

  describe("when this process has no spend pipeline registered", () => {
    it("throws, so the fact is delivered again rather than dropped", async () => {
      const { spend } = harness({ result: { status: "unavailable" } });

      await expect(spend.recordJudgeSpend({ fact: pricedFact() })).rejects.toThrow(
        /spend pipeline/,
      );
    });
  });
});
