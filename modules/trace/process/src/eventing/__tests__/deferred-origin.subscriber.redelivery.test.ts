/**
 * @vitest-environment node
 * @unit
 * Redelivery contract: the fallback re-reads the summary, and its command is keyed per trace.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { ResolveOriginCommandData, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { DEFERRED_ORIGIN_SUBSCRIBER_NAME } from "../deferred-origin.subscriber.ts";
import { EventingTraceOriginAdapter } from "../trace-origin.commands.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";
import { createInitState, createSpanReceivedEvent } from "./trace-summary-test.fixtures.ts";

type Input = TraceProcessingPipelineInput;
const TRACE_ID = "aaaa0000000000000000000000000001";

function summaryWith(origin?: string): TraceSummaryData {
  return { ...createInitState(), attributes: origin ? { "langwatch.origin": origin } : {} };
}

/** `findSummary` answers each delivery's re-read in turn. */
function compose({ reads }: { reads: TraceSummaryData[] }) {
  const dispatched: ResolveOriginCommandData[] = [];
  const findSummary = vi.fn<Input["findSummary"]>();
  for (const read of reads) findSummary.mockResolvedValueOnce(read);
  const pipeline = TraceProcessingRuntimeAdapter.create({
    role: "worker",
    tokenizer: createApiFixture<Input["tokenizer"]>(),
    peers: createApiFixture<Input["peers"]>(),
    repositories: MemoryTraceRepositories.create(),
    canonicalisation: TraceCanonicalisationService.create(),
    commands: createApiFixture<Input["commands"]>({
      resolveOrigin: async (data) => {
        dispatched.push(data);
      },
    }),
    findSummary,
    recordTrackedEvent: async () => undefined,
    broadcast: createApiFixture<Input["broadcast"]>(),
    milestones: createApiFixture<Input["milestones"]>(),
  }).build({ participation: "consume" });
  const subscriber = pipeline.foldSubscribers.get(DEFERRED_ORIGIN_SUBSCRIBER_NAME);
  if (!subscriber) throw new Error("no deferredOriginResolution subscriber");
  const deliver = () =>
    subscriber.definition.handle(createSpanReceivedEvent({ occurredAt: Date.now() }), {
      tenantId: "tenant-1",
      aggregateId: TRACE_ID,
      foldState: summaryWith(),
    });
  return { deliver, dispatched };
}

describe("given an armed deferred origin job for a trace", () => {
  describe("when it is redelivered after the first delivery's origin landed", () => {
    it("dispatches the fallback once, because the second re-read finds the origin", async () => {
      const { deliver, dispatched } = compose({
        reads: [summaryWith(), summaryWith("application")],
      });

      await deliver();
      await deliver();

      expect(dispatched).toHaveLength(1);
    });
  });

  describe("when it is redelivered before the first delivery's origin landed", () => {
    it("dispatches one command identity across both deliveries", async () => {
      const { deliver, dispatched } = compose({ reads: [summaryWith(), summaryWith()] });

      await deliver();
      await deliver();

      expect(dispatched).toHaveLength(2);
      expect(
        new Set(dispatched.map((data) => EventingTraceOriginAdapter.makeJobId(data))).size,
      ).toBe(1);
      expect(dispatched.map((data) => data.origin)).toEqual(["application", "application"]);
    });
  });
});
