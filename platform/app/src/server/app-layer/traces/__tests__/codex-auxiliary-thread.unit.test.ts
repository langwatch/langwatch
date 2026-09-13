/**
 * Codex helper threads at ingestion, driven with spans captured from codex
 * 0.154.0 (`fixtures/codex-0154-helper-thread.spans.json`): one user turn and
 * the thread title generation it triggered, exported by the same process.
 *
 * @see specs/coding-agent/trace-fidelity.feature
 */
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { describe, expect, it, vi } from "vitest";
import type {
  PIIRedactionLevel,
  RecordSpanCommandData,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  AUXILIARY_SESSION_ATTR,
  InMemoryAuxiliaryTraceMemo,
  isCodexTemporaryStructuredRequestSpan,
} from "../codex-auxiliary-thread";
import type { SpanDedupService } from "../span-dedupe.service";
import { TraceRequestCollectionService } from "../trace-request-collection.service";
import fixture from "./fixtures/codex-0154-helper-thread.spans.json";

const tenantId = "project_test";
const piiRedactionLevel: PIIRedactionLevel = "ESSENTIAL";

/** The helper turn's trace: `turn/start` root, then the turn span. */
const HELPER_TURN_TRACE = "76fdf6e1";
/** The user turn's trace, whose `turn/start` carries the TUI's counter. */
const USER_TURN_TRACE = "2a5259d4";

type FixtureSpan = (typeof fixture.spans)[number];

function spansOf(tracePrefix: string, ...names: string[]): FixtureSpan[] {
  return fixture.spans.filter(
    (span) =>
      span.traceId.startsWith(tracePrefix) &&
      (names.length === 0 || names.includes(span.name)),
  );
}

function attributesOf(span: FixtureSpan): Record<string, unknown> {
  return Object.fromEntries(
    span.attributes.map((a) => [
      a.key,
      (a.value as { stringValue?: unknown }).stringValue,
    ]),
  );
}

function makeService(memo?: InMemoryAuxiliaryTraceMemo) {
  const recordSpan = vi.fn<(data: RecordSpanCommandData) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const dedup: SpanDedupService = {
    tryAcquireProcessingLock: vi.fn(() => Promise.resolve(true)),
    tryConfirmProcessed: vi.fn(() => Promise.resolve()),
    tryReleaseOnFailure: vi.fn(() => Promise.resolve()),
  };
  const service = new TraceRequestCollectionService({
    dedup,
    recordSpan,
    ...(memo ? { auxiliaryTraces: memo } : {}),
  });
  return { service, recordSpan };
}

/** One export batch, as codex's otlp-http exporter posts it. */
function batch(spans: FixtureSpan[]): IExportTraceServiceRequest {
  return {
    resourceSpans: [
      {
        resource: fixture.resource,
        scopeSpans: [{ scope: fixture.scope, spans: spans as OtlpSpan[] }],
      },
    ],
  } as unknown as IExportTraceServiceRequest;
}

function recordedAttributeKeys(
  recordSpan: ReturnType<typeof makeService>["recordSpan"],
  spanName: string,
): string[] {
  const call = recordSpan.mock.calls.find(
    ([data]) => data.span.name === spanName,
  );
  if (!call) throw new Error(`${spanName} was not recorded`);
  return call[0].span.attributes.map((a) => a.key);
}

describe("isCodexTemporaryStructuredRequestSpan", () => {
  describe("given codex's app-server request spans", () => {
    describe("when the request was minted by the temporary structured request helper", () => {
      /** @scenario "A codex temporary structured request marks its trace as auxiliary" */
      it("recognises the thread/start and turn/start of the title thread", () => {
        const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
        const [threadStart] = spansOf("23acde07", "thread/start");
        expect(attributesOf(turnStart!)["rpc.request_id"]).toMatch(
          /^temporary-structured-turn-/,
        );
        expect(attributesOf(threadStart!)["rpc.request_id"]).toMatch(
          /^temporary-structured-/,
        );
        for (const span of [turnStart!, threadStart!]) {
          expect(
            isCodexTemporaryStructuredRequestSpan({
              scopeName: fixture.scope.name,
              attributes: attributesOf(span),
            }),
          ).toBe(true);
        }
      });
    });

    describe("when the request is the user's own turn", () => {
      /** @scenario "A codex turn span of an ordinary trace is not stamped" */
      it("does not recognise a turn/start carrying the TUI's request counter", () => {
        const [turnStart] = spansOf(USER_TURN_TRACE, "turn/start");
        expect(attributesOf(turnStart!)["rpc.request_id"]).toBe("5");
        expect(
          isCodexTemporaryStructuredRequestSpan({
            scopeName: fixture.scope.name,
            attributes: attributesOf(turnStart!),
          }),
        ).toBe(false);
      });
    });

    describe("when a span outside codex's scope reuses the request id shape", () => {
      it("declines it", () => {
        const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
        expect(
          isCodexTemporaryStructuredRequestSpan({
            scopeName: "com.acme.pipeline",
            attributes: attributesOf(turnStart!),
          }),
        ).toBe(false);
      });
    });
  });
});

describe("TraceRequestCollectionService and codex helper threads", () => {
  describe("given the helper turn's request span arrives in one export batch", () => {
    describe("when its turn span arrives in a later batch", () => {
      /** @scenario "A codex temporary structured request marks its trace as auxiliary" */
      it("filters the request span and remembers its trace", async () => {
        const memo = new InMemoryAuxiliaryTraceMemo();
        const { service, recordSpan } = makeService(memo);

        const result = await service.handleOtlpTraceRequest(
          tenantId,
          batch(
            spansOf(
              HELPER_TURN_TRACE,
              "turn/start",
              "app_server.serialized_request_queue",
            ),
          ),
          piiRedactionLevel,
        );

        expect(result.rejectedSpans).toBe(0);
        expect(recordSpan).not.toHaveBeenCalled();
        const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
        expect(await memo.has({ tenantId, traceId: turnStart!.traceId })).toBe(
          true,
        );
      });

      /** @scenario "The codex turn span of an auxiliary trace is stamped" */
      it("stamps the turn span with the auxiliary session mark", async () => {
        const memo = new InMemoryAuxiliaryTraceMemo();
        const { service, recordSpan } = makeService(memo);

        await service.handleOtlpTraceRequest(
          tenantId,
          batch(spansOf(HELPER_TURN_TRACE, "turn/start")),
          piiRedactionLevel,
        );
        await service.handleOtlpTraceRequest(
          tenantId,
          batch(
            spansOf(HELPER_TURN_TRACE, "session_task.turn", "handle_responses"),
          ),
          piiRedactionLevel,
        );

        expect(
          recordedAttributeKeys(recordSpan, "session_task.turn"),
        ).toContain(AUXILIARY_SESSION_ATTR);
        expect(recordedAttributeKeys(recordSpan, "handle_responses")).toContain(
          AUXILIARY_SESSION_ATTR,
        );
      });

      it("stamps the turn span even when both land in the same batch, turn first", async () => {
        const memo = new InMemoryAuxiliaryTraceMemo();
        const { service, recordSpan } = makeService(memo);
        const [turn] = spansOf(HELPER_TURN_TRACE, "session_task.turn");
        const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");

        await service.handleOtlpTraceRequest(
          tenantId,
          batch([turn!, turnStart!]),
          piiRedactionLevel,
        );

        expect(
          recordedAttributeKeys(recordSpan, "session_task.turn"),
        ).toContain(AUXILIARY_SESSION_ATTR);
      });
    });
  });

  describe("given the user's own turn", () => {
    describe("when its spans are ingested", () => {
      /** @scenario "A codex turn span of an ordinary trace is not stamped" */
      it("stores the turn span without the mark", async () => {
        const memo = new InMemoryAuxiliaryTraceMemo();
        const { service, recordSpan } = makeService(memo);

        await service.handleOtlpTraceRequest(
          tenantId,
          batch(spansOf(USER_TURN_TRACE)),
          piiRedactionLevel,
        );

        expect(
          recordedAttributeKeys(recordSpan, "session_task.turn"),
        ).not.toContain(AUXILIARY_SESSION_ATTR);
      });
    });
  });

  describe("given a process with no memo", () => {
    describe("when a helper turn is ingested", () => {
      it("stores the turn span unmarked rather than failing", async () => {
        const { service, recordSpan } = makeService();

        await service.handleOtlpTraceRequest(
          tenantId,
          batch(spansOf(HELPER_TURN_TRACE)),
          piiRedactionLevel,
        );

        expect(
          recordedAttributeKeys(recordSpan, "session_task.turn"),
        ).not.toContain(AUXILIARY_SESSION_ATTR);
      });
    });
  });

  describe("given a memo that fails", () => {
    describe("when a helper turn is ingested", () => {
      it("keeps ingesting and stores the span unmarked", async () => {
        const failing = {
          mark: vi.fn(() => Promise.reject(new Error("redis down"))),
          has: vi.fn(() => Promise.reject(new Error("redis down"))),
        };
        const { service, recordSpan } = makeService(
          failing as unknown as InMemoryAuxiliaryTraceMemo,
        );

        const result = await service.handleOtlpTraceRequest(
          tenantId,
          batch(spansOf(HELPER_TURN_TRACE)),
          piiRedactionLevel,
        );

        expect(result.ingestionFailures).toBe(0);
        expect(
          recordedAttributeKeys(recordSpan, "session_task.turn"),
        ).not.toContain(AUXILIARY_SESSION_ATTR);
      });
    });
  });
});
