// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The governance subscribers are registered on the trace_processing pipeline,
 * so they fan out on every trace fold completion, and each one only does
 * work for its own slice of traffic: ingestion-source traces.
 *
 * That relevance check belongs in `shouldDispatch`, which the router evaluates
 * BEFORE a job is packed and queued (ADR-026). A check that lives only
 * inside `handle` still passes a per-subscriber test, because the handler
 * no-ops either way, while the job is serialized, queued, dispatched and
 * unpacked first, and counts as a success rather than a skip in
 * `es_reactor_total`.
 *
 * So the unit under test here is the router with the real subscribers
 * registered: no job enqueued, no handler run, and the skip counter moved.
 */

import {
  createGovernanceKpisSyncHandler,
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  isGovernanceKpiTrace,
} from "@ee/governance/subscribers/governanceKpisSync.subscriber";
import {
  createGovernanceOcsfEventsSyncHandler,
  GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
  isGovernanceOcsfTrace,
} from "@ee/governance/subscribers/governanceOcsfEventsSync.subscriber";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Event } from "~/server/event-sourcing/domain/types";
import { buildTraceDeps } from "~/server/event-sourcing/pipelines/trace-processing/__tests__/support/traceProcessingFixtures";
import { createTraceProcessingPipeline } from "~/server/event-sourcing/pipelines/trace-processing/pipeline";
import { ProjectionRouter } from "~/server/event-sourcing/projections/projectionRouter";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "~/server/event-sourcing/services/__tests__/testHelpers";
import type { SubscriberDispatchDefinition } from "~/server/event-sourcing/subscribers/subscriber.types";
import { throttledWindow } from "~/server/event-sourcing/subscribers/throttleWindow";
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

/**
 * The registrations under test are built through the REAL trace pipeline with
 * the specs composed the way the registry composes them, so what the router
 * evaluates here is exactly what production registers.
 */
function createGovernanceSubscriberDefinitions(): SubscriberDispatchDefinition<Event>[] {
  const pipeline = createTraceProcessingPipeline(
    buildTraceDeps({
      governanceKpisSync: {
        fold: "traceSummary",
        when: isGovernanceKpiTrace,
        ...throttledWindow({
          makeId: (e) => `${e.tenantId}:${e.aggregateId}`,
          windowMs: GOVERNANCE_KPIS_SYNC_WINDOW_MS,
        }),
        handler: createGovernanceKpisSyncHandler({
          governanceKpisRepository: { insertContribution: vi.fn() } as any,
        }),
      },
      governanceOcsfEventsSync: {
        fold: "traceSummary",
        when: isGovernanceOcsfTrace,
        ...throttledWindow({
          makeId: (e) => `${e.tenantId}:${e.aggregateId}`,
          windowMs: GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
        }),
        handler: createGovernanceOcsfEventsSyncHandler({
          governanceOcsfEventsRepository: { insertEvent: vi.fn() } as any,
        }),
      },
    }),
  );
  return [
    pipeline.foldSubscribers.get("governanceKpisSync")!.definition,
    pipeline.foldSubscribers.get("governanceOcsfEventsSync")!.definition,
  ] as unknown as SubscriberDispatchDefinition<Event>[];
}

function createRouterWithGovernanceSubscribers(state: TraceSummaryData) {
  const send = vi.fn().mockResolvedValue(undefined);
  const queueManager = createMockQueueManager({
    hasProjectionSubscriberQueues: true,
    getProjectionSubscriberQueue: vi.fn().mockReturnValue({ send }),
  });
  const router = new ProjectionRouter(
    TEST_CONSTANTS.AGGREGATE_TYPE,
    TEST_CONSTANTS.PIPELINE_NAME,
    queueManager,
  );

  const store = createMockFoldProjectionStore<TraceSummaryData>();
  (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  router.registerFoldProjection(
    createMockFoldProjectionDefinition(FOLD_NAME, {
      store,
      init: () => state,
      apply: () => state,
    }),
  );

  for (const subscriber of createGovernanceSubscriberDefinitions()) {
    router.registerSubscriber(FOLD_NAME, subscriber);
  }

  return { router, send };
}

describe("governance subscribers on the trace-processing router", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a trace that is neither gateway nor governance traffic", () => {
    describe("when the fold completes", () => {
      it("enqueues no subscriber job", async () => {
        const { router, send } = createRouterWithGovernanceSubscribers(
          createFoldState({ "langwatch.origin": "app" }),
        );

        await router.dispatch(
          [
            createTestEvent(
              TEST_CONSTANTS.AGGREGATE_ID,
              TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            ),
          ],
          { tenantId },
        );

        expect(send).not.toHaveBeenCalled();
      });

      it("counts each subscriber as skipped rather than succeeded", async () => {
        const { router } = createRouterWithGovernanceSubscribers(
          createFoldState({ "langwatch.origin": "app" }),
        );

        await router.dispatch(
          [
            createTestEvent(
              TEST_CONSTANTS.AGGREGATE_ID,
              TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            ),
          ],
          { tenantId },
        );

        for (const subscriberName of [
          "governanceKpisSync",
          "governanceOcsfEventsSync",
        ]) {
          expect(incrementEsReactorTotal).toHaveBeenCalledWith(
            TEST_CONSTANTS.PIPELINE_NAME,
            subscriberName,
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
      it("enqueues both governance subscribers", async () => {
        const { router, send } = createRouterWithGovernanceSubscribers(
          createFoldState({
            "langwatch.origin.kind": "ingestion_source",
            "langwatch.ingestion_source.id": "is-1",
          }),
        );

        await router.dispatch(
          [
            createTestEvent(
              TEST_CONSTANTS.AGGREGATE_ID,
              TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            ),
          ],
          { tenantId },
        );

        expect(send).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a gateway trace", () => {
    describe("when the fold completes", () => {
      it("declines both governance subscribers", async () => {
        const { router, send } = createRouterWithGovernanceSubscribers(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "greq-1",
          }),
        );

        await router.dispatch(
          [
            createTestEvent(
              TEST_CONSTANTS.AGGREGATE_ID,
              TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
            ),
          ],
          { tenantId },
        );

        expect(send).not.toHaveBeenCalled();
        for (const subscriberName of [
          "governanceKpisSync",
          "governanceOcsfEventsSync",
        ]) {
          expect(incrementEsReactorTotal).toHaveBeenCalledWith(
            TEST_CONSTANTS.PIPELINE_NAME,
            subscriberName,
            "skipped",
          );
        }
      });
    });
  });
});
