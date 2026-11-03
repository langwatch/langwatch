/**
 * @vitest-environment node
 * Spec: modules/trace/specs/deferred-origin-compact-job.feature
 */
import { gzipSync } from "node:zlib";

import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import {
  DEFERRED_ORIGIN_DELAY_MS,
  DEFERRED_ORIGIN_SUBSCRIBER_NAME,
  WRITE_COMPACT_ORIGIN_JOBS,
} from "../deferred-origin.subscriber.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";
import { createInitState, createSpanReceivedEvent } from "./trace-summary-test.fixtures.ts";

type Input = TraceProcessingPipelineInput;
const TRACE_ID = "aaaa0000000000000000000000000001";
const TENANT_ID = "tenant-1";

function summaryWith(origin?: string): TraceSummaryData {
  return {
    ...createInitState(),
    traceId: TRACE_ID,
    attributes: origin ? { "langwatch.origin": origin } : {},
  };
}

function compose({
  storedSummary = summaryWith(),
  writeCompactOriginJobs,
}: {
  storedSummary?: TraceSummaryData | null;
  writeCompactOriginJobs?: boolean;
} = {}) {
  const resolveOrigin = vi.fn<Input["commands"]["resolveOrigin"]>(async () => undefined);
  const findSummary = vi.fn<Input["findSummary"]>(async () => storedSummary);
  const pipeline = TraceProcessingRuntimeAdapter.create({
    role: "worker",
    authorizeFoldRead: ownProofAuthorizer,
    tokenizer: createApiFixture<Input["tokenizer"]>(),
    peers: createApiFixture<Input["peers"]>(),
    repositories: MemoryTraceRepositories.create(),
    canonicalisation: TraceCanonicalisationService.create(),
    spool: createApiFixture<Input["spool"]>(),
    commands: createApiFixture<Input["commands"]>({ resolveOrigin }),
    findSummary,
    recordTrackedEvent: async () => undefined,
    broadcast: createApiFixture<Input["broadcast"]>(),
    milestones: createApiFixture<Input["milestones"]>(),
    ...(writeCompactOriginJobs === undefined ? {} : { writeCompactOriginJobs }),
  }).build({ participation: "consume" });
  const entry = pipeline.foldSubscribers.get(DEFERRED_ORIGIN_SUBSCRIBER_NAME);
  const compactJob = entry?.definition.compactJob;
  if (!entry || !compactJob) throw new Error("no deferredOriginResolution compact job");
  return { definition: entry.definition, compactJob, resolveOrigin, findSummary };
}

const dispatchContext = { tenantId: TENANT_ID, aggregateId: TRACE_ID, foldState: summaryWith() };

function fallbackFor(occurredAtMs: number) {
  return {
    findSummary: { projectId: TENANT_ID, traceId: TRACE_ID, occurredAtMs },
    resolveOrigin: expect.objectContaining({
      tenantId: TENANT_ID,
      traceId: TRACE_ID,
      origin: "application",
      reason: "deferred_fallback",
    }),
  };
}

/** A typical chat span: model, usage, a short conversation in and a reply out. */
function typicalSpan(occurredAt: number) {
  const input = JSON.stringify([
    { role: "system", content: "You are a helpful assistant for a travel booking service." },
    { role: "user", content: "Find me a direct flight from Amsterdam to Lisbon next Friday." },
  ]);
  const output = JSON.stringify([
    {
      role: "assistant",
      content:
        "There are three direct flights on Friday: 07:10, 12:45 and 18:20. The midday one is cheapest.",
    },
  ]);
  return createSpanReceivedEvent({
    occurredAt,
    parentSpanId: "bbbb000000000000",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gpt-5-mini",
      "gen_ai.usage.input_tokens": 412,
      "gen_ai.usage.output_tokens": 96,
      "langwatch.input": input,
      "langwatch.output": output,
      "langwatch.thread.id": "thread-7f3a9c",
      "langwatch.user.id": "user-1842",
    },
    resourceAttributes: {
      "service.name": "booking-agent",
      "telemetry.sdk.language": "python",
      "telemetry.sdk.name": "opentelemetry",
      "telemetry.sdk.version": "1.36.0",
    },
  });
}

/** The group queue stores raw JSON up to this size and only tries gzip above it. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * The bytes the group queue stores for a body: JSON, gzipped and base64 encoded when it is over
 * the threshold and the encoding comes out smaller.
 */
function encodedBytes(body: object): { json: number; stored: number } {
  const json = JSON.stringify(body);
  const jsonBytes = Buffer.byteLength(json);
  if (jsonBytes <= COMPRESSION_THRESHOLD_BYTES) return { json: jsonBytes, stored: jsonBytes };
  const gzipped = gzipSync(json).toString("base64");
  return { json: jsonBytes, stored: Math.min(jsonBytes, Buffer.byteLength(gzipped) + 1) };
}

describe("the deferred origin check's queued job", () => {
  describe("given a trace's first span is a child span with no origin", () => {
    /** @scenario "A child span arriving before its root arms the deferred check" */
    it("arms one check for the trace", () => {
      const { definition } = compose();
      const child = createSpanReceivedEvent({
        occurredAt: Date.now(),
        parentSpanId: "bbbb000000000000",
      });

      expect(definition.shouldDispatch?.(child, dispatchContext)).toBe(true);
      expect(definition.options?.deduplication?.makeId({ event: child, foldState: {} })).toBe(
        `subscriber:${DEFERRED_ORIGIN_SUBSCRIBER_NAME}:${TENANT_ID}:${TRACE_ID}`,
      );
    });
  });

  describe("when a root naming an origin arrived before the check runs", () => {
    /** @scenario "A late root that names an origin before the deadline leaves nothing to resolve" */
    it("re-reads the stored summary and sends nothing", async () => {
      const { compactJob, resolveOrigin, findSummary } = compose({
        storedSummary: summaryWith("evaluation"),
      });
      const occurredAtMs = Date.now();

      await compactJob.handle(
        { tenantId: TENANT_ID, traceId: TRACE_ID, occurredAtMs },
        { tenantId: TENANT_ID, aggregateId: TRACE_ID },
      );

      expect(findSummary).toHaveBeenCalledWith(fallbackFor(occurredAtMs).findSummary);
      expect(resolveOrigin).not.toHaveBeenCalled();
    });
  });

  describe("when the check runs on a trace no span named an origin for", () => {
    /** @scenario "A silent trace is resolved as application once the check runs" */
    it("resolves the trace as application with the deferred fallback reason", async () => {
      const { compactJob, resolveOrigin } = compose({ storedSummary: null });
      const occurredAtMs = Date.now();

      await compactJob.handle(
        { tenantId: TENANT_ID, traceId: TRACE_ID, occurredAtMs },
        { tenantId: TENANT_ID, aggregateId: TRACE_ID },
      );

      expect(resolveOrigin).toHaveBeenCalledWith(fallbackFor(occurredAtMs).resolveOrigin);
    });
  });

  describe("given a job the previous release queued with the whole first span event", () => {
    /** @scenario "A full-event job still queued resolves the trace as before" */
    it("resolves the trace from its tenant, trace id and the span's instant", async () => {
      const { definition, resolveOrigin, findSummary } = compose();
      const occurredAt = Date.now();

      await definition.handle(typicalSpan(occurredAt), dispatchContext);

      expect(findSummary).toHaveBeenCalledWith(fallbackFor(occurredAt).findSummary);
      expect(resolveOrigin).toHaveBeenCalledWith(fallbackFor(occurredAt).resolveOrigin);
    });
  });

  describe("given a job carrying only the tenant, the trace id and the span's instant", () => {
    /** @scenario "A compact job resolves the trace through the same handler" */
    it("resolves the trace exactly as a full-event job does", async () => {
      const full = compose();
      const compact = compose();
      const occurredAt = Date.now();

      await full.definition.handle(typicalSpan(occurredAt), dispatchContext);
      await compact.compactJob.handle(
        { tenantId: TENANT_ID, traceId: TRACE_ID, occurredAtMs: occurredAt },
        { tenantId: TENANT_ID, aggregateId: TRACE_ID },
      );

      expect(compact.findSummary.mock.calls).toEqual(full.findSummary.mock.calls);
      expect(compact.resolveOrigin).toHaveBeenCalledWith(fallbackFor(occurredAt).resolveOrigin);
    });

    describe("when its span went stale while queued", () => {
      /** @scenario "A compact job whose span went stale while queued resolves nothing" */
      it("sends no resolveOrigin command", async () => {
        const { compactJob, resolveOrigin, findSummary } = compose();
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

        await compactJob.handle(
          { tenantId: TENANT_ID, traceId: TRACE_ID, occurredAtMs: twoHoursAgo },
          { tenantId: TENANT_ID, aggregateId: TRACE_ID },
        );

        expect(findSummary).not.toHaveBeenCalled();
        expect(resolveOrigin).not.toHaveBeenCalled();
      });
    });

    describe("when its body has no trace id", () => {
      /** @scenario "A compact job its schema refuses is not run" */
      it("fails and sends nothing", async () => {
        const { compactJob, resolveOrigin } = compose();

        await expect(
          compactJob.handle(
            { tenantId: TENANT_ID, occurredAtMs: Date.now() },
            { tenantId: TENANT_ID, aggregateId: TRACE_ID },
          ),
        ).rejects.toThrow(/traceId/);
        expect(resolveOrigin).not.toHaveBeenCalled();
      });
    });
  });

  describe("when deciding which body to queue", () => {
    /** @scenario "This release reads compact bodies but still writes the full-event body" */
    it("queues the full delivery unless the write switch is flipped", () => {
      expect(WRITE_COMPACT_ORIGIN_JOBS).toBe(false);
      expect(compose().compactJob.stageOnSend).toBe(false);
      expect(compose({ writeCompactOriginJobs: true }).compactJob.stageOnSend).toBe(true);
    });

    /** @scenario "The compact body carries no span content and stays under one kilobyte" */
    it("stages only identifiers, far smaller than the full-event body", () => {
      const { compactJob } = compose({ writeCompactOriginJobs: true });
      const event = typicalSpan(Date.now());
      const compactBody = {
        event: {
          id: event.id,
          aggregateId: event.aggregateId,
          aggregateType: event.aggregateType,
          tenantId: event.tenantId,
          createdAt: event.createdAt,
          occurredAt: event.occurredAt,
          type: event.type,
        },
        job: compactJob.stage(event, dispatchContext),
      };

      expect(compactBody.job).toEqual({
        tenantId: TENANT_ID,
        traceId: TRACE_ID,
        occurredAtMs: event.occurredAt,
      });
      const full = encodedBytes({ event, foldState: summaryWith() });
      const compact = encodedBytes(compactBody);
      expect(JSON.stringify(compactBody)).not.toContain("booking-agent");
      expect(compact.stored).toBeLessThan(1024);
      // Measured 2026-10-20: full 3059 B JSON, 1501 B stored;
      // compact 312 B JSON, stored raw at 312 B.
      expect(compact.stored * 4).toBeLessThan(full.stored);
    });

    /** @scenario "The deadline and the per-trace deduplication do not depend on the body" */
    it("waits five minutes and holds one job per trace either way", () => {
      const off = compose({ writeCompactOriginJobs: false }).definition.options;
      const on = compose({ writeCompactOriginJobs: true }).definition.options;
      const delivery = { event: typicalSpan(Date.now()), foldState: summaryWith() };

      expect(on?.delay).toBe(DEFERRED_ORIGIN_DELAY_MS);
      expect(off?.delay).toBe(DEFERRED_ORIGIN_DELAY_MS);
      expect(on?.deduplication?.makeId(delivery)).toBe(off?.deduplication?.makeId(delivery));
      expect(on?.deduplication?.extend).toBe(false);
      expect(on?.deduplication?.replace).toBe(false);
    });
  });
});
