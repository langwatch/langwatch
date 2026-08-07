// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The governance reactors are registered on the trace_processing pipeline,
 * so they fan out on every trace fold completion, and each one only does
 * work for its own slice of traffic: ingestion-source traces.
 *
 * That relevance check belongs in `shouldReact`, which the router evaluates
 * BEFORE a job is packed and queued (ADR-026). A check that lives only
 * inside `handle` still passes a per-reactor test, because the handler
 * no-ops either way, while the job is serialized, queued, dispatched and
 * unpacked first, and counts as a success rather than a skip in
 * `es_reactor_total`.
 *
 * So the unit under test here is the router with the real reactors
 * registered: no job enqueued, no handler run, and the skip counter moved.
 */

import { createGovernanceKpisSyncReactor } from "@ee/governance/reactors/governanceKpisSync.reactor";
import { createGovernanceOcsfEventsSyncReactor } from "@ee/governance/reactors/governanceOcsfEventsSync.reactor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Event } from "~/server/event-sourcing/domain/types";
import { ProjectionRouter } from "~/server/event-sourcing/projections/projectionRouter";
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "~/server/event-sourcing/services/__tests__/testHelpers";
import { incrementEsReactorTotal } from "~/server/metrics";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return {
    ...actual,
    incrementEsReactorTotal: vi.fn(),
  };
});

const FOLD_NAME = "trace-summary";

function createFoldState(attributes: Record<string, string>): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 120,
    models: ["gpt-5-mini"],
    totalCost: 0.001,
    totalPromptTokenCount: 10,
    totalCompletionTokenCount: 5,
    blockedByGuardrail: false,
    containsErrorStatus: false,
    occurredAt: 1_700_000_000_000,
    attributes,
  } as unknown as TraceSummaryData;
}

function createGovernanceReactors(): ReactorDefinition<Event>[] {
  return [
    createGovernanceKpisSyncReactor({
      governanceKpisRepository: { insertContribution: vi.fn() } as any,
    }),
    createGovernanceOcsfEventsSyncReactor({
      governanceOcsfEventsRepository: { insertEvent: vi.fn() } as any,
    }),
  ] as unknown as ReactorDefinition<Event>[];
}

function createRouterWithGovernanceReactors(foldState: TraceSummaryData) {
  const send = vi.fn().mockResolvedValue(undefined);
  const queueManager = createMockQueueManager({
    hasReactorQueues: true,
    getReactorQueue: vi.fn().mockReturnValue({ send }),
  });
  const router = new ProjectionRouter({
    aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    queueManager,
  });

  const store = createMockFoldProjectionStore<TraceSummaryData>();
  (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  router.registerFoldProjection(
    createMockFoldProjectionDefinition(FOLD_NAME, {
      store,
      init: () => foldState,
      apply: () => foldState,
    }),
  );

  for (const reactor of createGovernanceReactors()) {
    router.registerReactor(FOLD_NAME, reactor);
  }

  return { router, send };
}

describe("governance reactors on the trace-processing router", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a trace that is neither gateway nor governance traffic", () => {
    describe("when the fold completes", () => {
      it("enqueues no reactor job", async () => {
        const { router, send } = createRouterWithGovernanceReactors(
          createFoldState({ "langwatch.origin": "app" }),
        );

        await router.dispatch(
          [
            createTestEvent({
              aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
              aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            }),
          ],
          { tenantId },
        );

        expect(send).not.toHaveBeenCalled();
      });

      it("counts each reactor as skipped rather than succeeded", async () => {
        const { router } = createRouterWithGovernanceReactors(
          createFoldState({ "langwatch.origin": "app" }),
        );

        await router.dispatch(
          [
            createTestEvent({
              aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
              aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            }),
          ],
          { tenantId },
        );

        for (const reactorName of [
          "governanceKpisSync",
          "governanceOcsfEventsSync",
        ]) {
          expect(incrementEsReactorTotal).toHaveBeenCalledWith(
            TEST_CONSTANTS.PIPELINE_NAME,
            reactorName,
            "skipped",
          );
        }
        expect(incrementEsReactorTotal).not.toHaveBeenCalledWith(
          TEST_CONSTANTS.PIPELINE_NAME,
          expect.anything(),
          "success",
        );
      });
    });
  });

  describe("given a governance-origin trace", () => {
    describe("when the fold completes", () => {
      it("enqueues both governance reactors", async () => {
        const { router, send } = createRouterWithGovernanceReactors(
          createFoldState({
            "langwatch.origin.kind": "ingestion_source",
            "langwatch.ingestion_source.id": "is-1",
          }),
        );

        await router.dispatch(
          [
            createTestEvent({
              aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
              aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            }),
          ],
          { tenantId },
        );

        expect(send).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a gateway trace", () => {
    describe("when the fold completes", () => {
      it("declines both governance reactors", async () => {
        const { router, send } = createRouterWithGovernanceReactors(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "greq-1",
          }),
        );

        await router.dispatch(
          [
            createTestEvent({
              aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
              aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            }),
          ],
          { tenantId },
        );

        expect(send).not.toHaveBeenCalled();
        for (const reactorName of [
          "governanceKpisSync",
          "governanceOcsfEventsSync",
        ]) {
          expect(incrementEsReactorTotal).toHaveBeenCalledWith(
            TEST_CONSTANTS.PIPELINE_NAME,
            reactorName,
            "skipped",
          );
        }
      });
    });
  });
});
