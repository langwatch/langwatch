/**
 * ADR-066 pillar 2 for the coding-agent contributions.
 *
 * Every contribution is keyed on its session, so one session is one queue group
 * and a long run drains its transcript one tiny insert at a time. Coalescing
 * folds the group's queued contributions into a single multi-row append.
 *
 * The property that makes this safe — and that sharding the session key would
 * destroy — is that coalescing does not reorder. A logs-only agent's model calls
 * fold through `foldModelCall`, which derives its cache-rebuild comparison, its
 * final request id and its stop reason from the ORDER the calls arrive in, so
 * these tests pin the order through the batch and out the other side.
 *
 * See specs/coding-agent/session-aggregate.feature and
 * packages/eventing/specs/producer-append-coalescing.feature.
 */

import type { Event } from "@langwatch/eventing";
import { processCommandBatch } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import {
  CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
  CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
  type ContributeLogFactsCommandData,
} from "@langwatch/coding-agent-contract";
import { EventingContributeLogFactsAdapter } from "../../adapters/eventing.contribute-log-facts.adapter";
import { InMemorySessionContextMemoAdapter } from "../../adapters/in-memory.session-context-memo.adapter";
import { CodingAgentSessionLogProjection } from "../coding-agent-session-log.projection";
import { CodingAgentSessionStateProjection } from "../coding-agent-session-state.projection";
import { buildTestCodingAgentProcessingPipeline } from "../../adapters/__tests__/fixtures/coding-agent-processing.fixture";

const TENANT_ID = "tenant-coding-agent-coalescing";
const SESSION_ID = "session-abc";
/** Cowork is the registry's logs-only agent, so its model calls fold from logs. */
const LOGS_ONLY_AGENT = "claude_cowork";
const stateProjection = CodingAgentSessionStateProjection.create();
const logProjection = CodingAgentSessionLogProjection.create({ stateProjection });

function buildPipeline() {
  return buildTestCodingAgentProcessingPipeline();
}

function commandNamed(name: string) {
  return buildPipeline().commands.find((candidate) => candidate.name === name);
}

/** One api_request log contribution — the shape that folds as a model call. */
function modelCallPayload({
  index,
  contextTokens,
  stopReason,
}: {
  index: number;
  contextTokens: number;
  stopReason?: string;
}): ContributeLogFactsCommandData {
  return {
    tenantId: TENANT_ID,
    sessionId: SESSION_ID,
    sessionKeySource: "provider",
    agent: LOGS_ONLY_AGENT,
    occurredAt: 1_700_000_000_000 + index,
    recordId: `record-${index}`,
    traceId: null,
    spanId: null,
    timeUnixMs: 1_700_000_000_000 + index,
    severityNumber: 9,
    providerKind: "generic",
    scopeName: null,
    facts: {
      "event.name": "api_request",
      request_id: `req-${index}`,
      cache_read_tokens: contextTokens,
      cache_creation_tokens: 0,
      ...(stopReason ? { stop_reason: stopReason } : {}),
    },
  } as ContributeLogFactsCommandData;
}

function batchParamsFor({
  payloads,
  storeEventsFn,
}: {
  payloads: ContributeLogFactsCommandData[];
  storeEventsFn: (events: Event[], context: unknown) => Promise<void>;
}) {
  return {
    payloads: payloads as unknown as Record<string, unknown>[],
    commandType: CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
    commandSchema: EventingContributeLogFactsAdapter.schema,
    handler: EventingContributeLogFactsAdapter.create({
      contextMemo: new InMemorySessionContextMemoAdapter(),
    }),
    getAggregateId: EventingContributeLogFactsAdapter.getAggregateId,
    storeEventsFn: storeEventsFn as never,
    aggregateType: "coding_agent_session" as const,
    commandName: "contributeLogFacts",
    pipelineName: "coding_agent_processing",
  };
}

/** Fold a batch's events through the log derivation, in the order given. */
function foldInOrder(events: Event[]) {
  let state = stateProjection.createInitCodingAgentSession();
  for (const event of events) {
    const data = event.data as ContributeLogFactsCommandData;
    state = logProjection.applyLogToCodingAgentSession({
      state,
      attributes: data.facts,
      agent: data.agent,
      occurredAtMs: data.timeUnixMs,
    });
  }
  return state;
}

describe("coding-agent contribution append coalescing", () => {
  describe("given the coding-agent pipeline is defined", () => {
    describe("when its contribution commands are registered", () => {
      /** @scenario "a busy session's contributions are written together" */
      it("gives every contribution command an append-coalescing bound", () => {
        for (const name of ["contributeSpanFacts", "contributeLogFacts", "contributeMetricFacts"]) {
          expect(commandNamed(name)?.options?.coalesceMaxBatch).toBe(
            CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
          );
        }
      });

      // Sharding would give one session parallel lanes at the cost of its
      // order; the fold's model-call chain cannot take that. The test below
      // this one is why.
      it("leaves the session key unsharded so one session stays one ordered lane", () => {
        expect(commandNamed("contributeLogFacts")?.options?.getGroupKey).toBeUndefined();
      });
    });
  });

  // The executable reason the lane above must stay ordered. If this ever stops
  // holding, sharding the session key becomes an option; while it holds, it is
  // not one.
  describe("given the same model calls folded in two different orders", () => {
    describe("when the session is assembled from each", () => {
      it("reports a different final request and context chain", () => {
        const calls = [
          modelCallPayload({ index: 0, contextTokens: 1_000 }),
          modelCallPayload({ index: 1, contextTokens: 5_000 }),
          modelCallPayload({ index: 2, contextTokens: 9_000 }),
        ].map((payload) => ({ data: payload }) as Event);

        const inOrder = foldInOrder(calls);
        const reordered = foldInOrder([...calls].reverse());

        expect(inOrder.finalRequestId).toBe("req-2");
        expect(reordered.finalRequestId).toBe("req-0");
        expect(inOrder.previousCallContextTokens).toBe(9_000);
        expect(reordered.previousCallContextTokens).toBe(1_000);
      });
    });
  });

  describe("given a session with several queued contributions", () => {
    describe("when the coalesced batch is processed", () => {
      /** @scenario "a busy session's contributions are written together" */
      it("appends them as one insert rather than one per contribution", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2, 3].map((index) =>
          modelCallPayload({ index, contextTokens: 1_000 }),
        );

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events, context] = storeEventsFn.mock.calls[0]!;
        expect(events as Event[]).toHaveLength(payloads.length);
        expect(context).toEqual({ tenantId: TENANT_ID });
      });

      /** @scenario "writing contributions together keeps the session's order" */
      it("keeps the contributions in the order the agent produced them", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2, 3].map((index) =>
          modelCallPayload({ index, contextTokens: 1_000 }),
        );

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        const [events] = storeEventsFn.mock.calls[0]!;
        expect((events as Event[]).map((event) => event.idempotencyKey)).toEqual(
          payloads.map((payload) => `${TENANT_ID}:${payload.recordId}`),
        );
        expect(new Set((events as Event[]).map((event) => event.aggregateId))).toEqual(
          new Set([SESSION_ID]),
        );
      });

      /** @scenario 'an agent that reports only logs keeps its model-call sequence' */
      it("folds the batch to the same session a per-contribution write would", async () => {
        const payloads = [
          modelCallPayload({ index: 0, contextTokens: 1_000 }),
          modelCallPayload({ index: 1, contextTokens: 5_000 }),
          modelCallPayload({
            index: 2,
            contextTokens: 9_000,
            stopReason: "max_tokens",
          }),
        ];

        const batched = vi.fn().mockResolvedValue(undefined);
        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn: batched }));
        const [batchedEvents] = batched.mock.calls[0]!;

        // The same payloads written one at a time, as the un-coalesced path did.
        const oneAtATime: Event[] = [];
        for (const payload of payloads) {
          const single = vi.fn().mockResolvedValue(undefined);
          await processCommandBatch(batchParamsFor({ payloads: [payload], storeEventsFn: single }));
          oneAtATime.push(...(single.mock.calls[0]![0] as Event[]));
        }

        expect(foldInOrder(batchedEvents as Event[])).toEqual(foldInOrder(oneAtATime));
      });

      /** @scenario 'an agent that reports only logs keeps its model-call sequence' */
      it("takes the final request and stop reason from the last call in the batch", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [
          modelCallPayload({ index: 0, contextTokens: 1_000 }),
          modelCallPayload({ index: 1, contextTokens: 5_000 }),
          modelCallPayload({
            index: 2,
            contextTokens: 9_000,
            stopReason: "max_tokens",
          }),
        ];

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));
        const [events] = storeEventsFn.mock.calls[0]!;
        const session = foldInOrder(events as Event[]);

        expect(session.modelCalls).toBe(3);
        expect(session.finalRequestId).toBe("req-2");
        expect(session.stopReason).toBe("max_tokens");
        expect(session.truncated).toBe(true);
        // The chain the next call is compared against: the LAST call's context.
        expect(session.previousCallContextTokens).toBe(9_000);
      });
    });
  });
});
