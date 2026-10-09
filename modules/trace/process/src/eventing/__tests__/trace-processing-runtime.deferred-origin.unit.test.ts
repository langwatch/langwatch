/**
 * @vitest-environment node
 * Spec: specs/traces/explicit-application-origin.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { DEFERRED_ORIGIN_SUBSCRIBER_NAME } from "../deferred-origin.subscriber.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";
import { createInitState, createSpanReceivedEvent } from "./trace-summary-test.fixtures.ts";

type Input = TraceProcessingPipelineInput;
const TRACE_ID = "aaaa0000000000000000000000000001";

function summaryWith(origin?: string): TraceSummaryData {
  const state = createInitState();
  return { ...state, attributes: origin ? { "langwatch.origin": origin } : {} };
}

function compose({ storedSummary }: { storedSummary: TraceSummaryData | null }) {
  const resolveOrigin = vi.fn<Input["commands"]["resolveOrigin"]>(async () => undefined);
  const findSummary = vi.fn<Input["findSummary"]>(async () => storedSummary);
  const pipeline = TraceProcessingRuntimeAdapter.create({
    role: "worker",
    tokenizer: createApiFixture<Input["tokenizer"]>(),
    peers: createApiFixture<Input["peers"]>(),
    repositories: MemoryTraceRepositories.create(),
    canonicalisation: TraceCanonicalisationService.create(),
    commands: createApiFixture<Input["commands"]>({ resolveOrigin }),
    findSummary,
    recordTrackedEvent: async () => undefined,
    broadcast: createApiFixture<Input["broadcast"]>(),
    milestones: createApiFixture<Input["milestones"]>(),
  }).build({ participation: "consume" });
  const subscriber = pipeline.foldSubscribers.get(DEFERRED_ORIGIN_SUBSCRIBER_NAME);
  if (!subscriber)
    throw new Error("the pipeline registered no deferredOriginResolution subscriber");
  return { subscriber, resolveOrigin, findSummary };
}

/** The job fires with the fold captured when the first span armed it: no origin yet. */
async function fireArmedJob(subscriber: ReturnType<typeof compose>["subscriber"]) {
  await subscriber.definition.handle(createSpanReceivedEvent({ occurredAt: Date.now() }), {
    tenantId: "tenant-1",
    aggregateId: TRACE_ID,
    foldState: summaryWith(),
  });
}

describe("the composed deferredOriginResolution subscriber", () => {
  describe("when the armed job fires and the stored summary still has no origin", () => {
    /** @scenario 'Deferred check treats still-empty origin as "application"' */
    it("re-reads the summary and resolves the trace as application", async () => {
      const { subscriber, resolveOrigin, findSummary } = compose({ storedSummary: summaryWith() });

      await fireArmedJob(subscriber);

      expect(findSummary).toHaveBeenCalledWith({ projectId: "tenant-1", traceId: TRACE_ID });
      expect(resolveOrigin).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          traceId: TRACE_ID,
          origin: "application",
          reason: "deferred_fallback",
        }),
      );
    });
  });

  describe("when a later span named an origin before the job fired", () => {
    it("dispatches nothing, because the fresh summary is already resolved", async () => {
      const { subscriber, resolveOrigin } = compose({ storedSummary: summaryWith("evaluation") });

      await fireArmedJob(subscriber);

      expect(resolveOrigin).not.toHaveBeenCalled();
    });
  });
});
