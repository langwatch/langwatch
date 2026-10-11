/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-first-seen.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { FIRST_SIGHTING_CLOCK_SKEW_MS } from "../../rules/trace-first-seen.rules.ts";
import type { EventingRecordSpanAdapter } from "../record-span.commands.ts";
import {
  createTraceFirstSeenHandler,
  isTraceFirstSighting,
  TRACE_FIRST_SEEN_SUBSCRIBER_NAME,
} from "../trace-first-seen.subscriber.ts";
import {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "../trace-processing-projections.pipeline.ts";
import { buildTraceProcessingConsumer } from "../trace-processing.pipeline.ts";
import {
  RecordTraceFirstSeenCommand,
  RecordTracesCountedBeforeCutCommand,
} from "../trace-project-milestones.commands.ts";
import {
  TENANT_ID,
  TRACE_ID,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
  createTopicAssignedEvent,
} from "./trace-subscriber.fixtures.ts";

type Options = EventingTracePipelineAdapterOptions;

const SUMMARY_CREATED_AT = Date.UTC(2026, 9, 8, 14, 0, 0);

function consumer() {
  const projections = EventingTracePipelineAdapter.create({
    spanStore: createApiFixture<Options["spanStore"]>(),
    summaryStore: createApiFixture<Options["summaryStore"]>(),
    derivedStore: createApiFixture<Options["derivedStore"]>(),
    rollupStore: createApiFixture<Options["rollupStore"]>(),
    canonicalisation: TraceCanonicalisationService.create(),
    ioExtraction: createApiFixture<Options["ioExtraction"]>(),
    mediaReferences: createApiFixture<Options["mediaReferences"]>(),
    modelCosts: createApiFixture<Options["modelCosts"]>(),
    spanNormalization: createApiFixture<Options["spanNormalization"]>(),
    prepareEventForProjection: (event) => event,
    recordSpanCommand: createApiFixture<EventingRecordSpanAdapter>(),
  }).build();
  const noop = vi.fn().mockResolvedValue(undefined);
  return buildTraceProcessingConsumer(projections, {
    resolveDeferredOrigin: noop,
    trackedEventSync: noop,
    traceUpdateBroadcast: noop,
    projectMetadata: noop,
    traceFirstSeen: noop,
    spanStorageBroadcast: noop,
    broadcastDisabled: false,
  });
}

function spanAppendedAt(createdAt: number): TraceProcessingEvent {
  return createSpanReceivedEvent(createOtlpSpan(), { createdAt });
}

const foldState = createFoldState({ createdAt: SUMMARY_CREATED_AT });

describe("the traceFirstSeen subscriber on trace_processing", () => {
  describe("when the pipeline registers its reactions", () => {
    /** @scenario "Each trace is recorded as first seen once, at its summary's first write" */
    it("is a worker subscriber on traceSummary holding one job per trace", () => {
      const entry = consumer().foldSubscribers.get(TRACE_FIRST_SEEN_SUBSCRIBER_NAME);

      expect(entry?.projectionName).toBe("traceSummary");
      const { deduplication } = entry?.definition.options ?? {};
      const job = { event: spanAppendedAt(1), foldState };
      expect(deduplication?.makeId(job)).toBe(`subscriber:traceFirstSeen:${TENANT_ID}:${TRACE_ID}`);
      expect(deduplication?.extend).toBe(false);
      expect(deduplication?.replace).toBe(false);
    });
  });

  describe("when a span folds into its trace's summary", () => {
    /** @scenario "Each trace is recorded as first seen once, at its summary's first write" */
    it("qualifies a span appended before the summary's first write, within the clock skew", () => {
      expect(
        isTraceFirstSighting({ event: spanAppendedAt(SUMMARY_CREATED_AT - 5), foldState }),
      ).toBe(true);
      expect(
        isTraceFirstSighting({
          event: spanAppendedAt(SUMMARY_CREATED_AT + FIRST_SIGHTING_CLOCK_SKEW_MS),
          foldState,
        }),
      ).toBe(true);
    });

    /** @scenario "A span arriving after the trace was first seen records nothing" */
    it("refuses a span appended after the first write, and every other event type", () => {
      expect(
        isTraceFirstSighting({
          event: spanAppendedAt(SUMMARY_CREATED_AT + FIRST_SIGHTING_CLOCK_SKEW_MS + 1),
          foldState,
        }),
      ).toBe(false);
      expect(
        isTraceFirstSighting({
          event: createTopicAssignedEvent({ createdAt: SUMMARY_CREATED_AT }),
          foldState,
        }),
      ).toBe(false);
    });

    /** @scenario "Each trace is recorded as first seen once, at its summary's first write" */
    it("records the sighting at the summary's first write", async () => {
      const recordTraceFirstSeen = vi.fn().mockResolvedValue(undefined);
      const handle = createTraceFirstSeenHandler({ milestones: { recordTraceFirstSeen } });

      await handle(spanAppendedAt(SUMMARY_CREATED_AT), {
        tenantId: TENANT_ID,
        aggregateId: TRACE_ID,
        state: foldState,
      });

      expect(recordTraceFirstSeen).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        projectId: TENANT_ID,
        traceId: TRACE_ID,
        firstSeenAt: SUMMARY_CREATED_AT,
      });
    });
  });
});

describe("trace's count facts", () => {
  /** @scenario "A re-sent fact is stored once" */
  it("keys a first sighting by trace and month, and a month's count by project and month", () => {
    const tenantId = createTenantId("project-1");
    const [sighting] = new RecordTraceFirstSeenCommand().handle({
      tenantId,
      aggregateId: "project-1",
      type: RecordTraceFirstSeenCommand.schema.type,
      data: {
        tenantId: "project-1",
        projectId: "project-1",
        traceId: "trace-1",
        firstSeenAt: SUMMARY_CREATED_AT,
      },
    });
    const [counted] = new RecordTracesCountedBeforeCutCommand().handle({
      tenantId,
      aggregateId: "project-1",
      type: RecordTracesCountedBeforeCutCommand.schema.type,
      data: {
        tenantId: "project-1",
        projectId: "project-1",
        month: "2026-10",
        cutAt: SUMMARY_CREATED_AT,
        traces: 40,
      },
    });

    expect(sighting).toMatchObject({
      aggregateId: "project-1",
      occurredAt: SUMMARY_CREATED_AT,
      idempotencyKey: "project-1:trace_first_seen:trace-1:2026-10",
    });
    expect(counted).toMatchObject({
      aggregateId: "project-1",
      idempotencyKey: "project-1:traces_counted_before_cut:2026-10",
    });
  });
});
