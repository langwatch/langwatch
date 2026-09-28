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
  AUXILIARY_SESSION_FACT,
  codexAuxiliarySessionFacts,
  codexHelperThreadMarkersOf,
  HELPER_THREAD_ID_ATTR,
  isCodexTemporaryStructuredRequestSpan,
} from "../codex-auxiliary-thread";
import type { SpanDedupService } from "../span-dedupe.service";
import { TraceRequestCollectionService } from "../trace-request-collection.service";
import fixture from "./fixtures/codex-0154-helper-thread.spans.json";

const tenantId = "project_test";
const piiRedactionLevel: PIIRedactionLevel = "ESSENTIAL";

/** The helper turn's trace: `turn/start` root, its queue child, the turn. */
const HELPER_TURN_TRACE = "76fdf6e1";
/** The helper thread id the queue child names. */
const HELPER_THREAD_ID = "01a09a08-9915-7450-bedb-bb08c55160d3";
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

function makeService() {
  const recordSpan = vi.fn<(data: RecordSpanCommandData) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const dedup: SpanDedupService = {
    tryAcquireProcessingLock: vi.fn(() => Promise.resolve(true)),
    tryConfirmProcessed: vi.fn(() => Promise.resolve()),
    tryReleaseOnFailure: vi.fn(() => Promise.resolve()),
  };
  const service = new TraceRequestCollectionService({ dedup, recordSpan });
  return { service, recordSpan };
}

/** One export batch, as codex's otlp-http exporter posts it. */
function batch(spans: FixtureSpan[]): IExportTraceServiceRequest {
  return batchOf([{ scope: fixture.scope, spans }]);
}

/** One export batch with the spans spread over several scope entries. */
function batchOf(
  entries: Array<{ scope: { name: string }; spans: FixtureSpan[] }>,
): IExportTraceServiceRequest {
  return {
    resourceSpans: [
      {
        resource: fixture.resource,
        scopeSpans: entries.map((entry) => ({
          scope: entry.scope,
          spans: entry.spans as OtlpSpan[],
        })),
      },
    ],
  } as unknown as IExportTraceServiceRequest;
}

function scoped(spans: FixtureSpan[]) {
  return { scopeName: fixture.scope.name, spans: spans as OtlpSpan[] };
}

function recordedSpans(
  recordSpan: ReturnType<typeof makeService>["recordSpan"],
): Array<{ name: string; attributes: Record<string, unknown> }> {
  return recordSpan.mock.calls.map(([data]) => ({
    name: data.span.name,
    attributes: Object.fromEntries(
      data.span.attributes.map((a) => [a.key, a.value.stringValue]),
    ),
  }));
}

describe("isCodexTemporaryStructuredRequestSpan", () => {
  describe("given codex's app-server request spans", () => {
    describe("when the request was minted by the temporary structured request helper", () => {
      /** @scenario "A codex temporary structured request names its helper thread" */
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

      it("derives the auxiliary fact for the session contribution", () => {
        const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
        expect(
          codexAuxiliarySessionFacts({
            scopeName: fixture.scope.name,
            attributes: attributesOf(turnStart!),
          }),
        ).toEqual({ [AUXILIARY_SESSION_FACT]: true });
      });
    });

    describe("when the request is the user's own turn", () => {
      /** @scenario "A codex turn of the user's own is not marked" */
      it("does not recognise a turn/start carrying the TUI's request counter", () => {
        const [turnStart] = spansOf(USER_TURN_TRACE, "turn/start");
        expect(attributesOf(turnStart!)["rpc.request_id"]).toBe("5");
        expect(
          isCodexTemporaryStructuredRequestSpan({
            scopeName: fixture.scope.name,
            attributes: attributesOf(turnStart!),
          }),
        ).toBe(false);
        expect(
          codexAuxiliarySessionFacts({
            scopeName: fixture.scope.name,
            attributes: attributesOf(turnStart!),
          }),
        ).toEqual({});
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

describe("codexHelperThreadMarkersOf", () => {
  describe("given one export batch of the helper turn", () => {
    /** @scenario "A codex temporary structured request names its helper thread" */
    it("maps the request span to the thread its queue child names", () => {
      const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
      const markers = codexHelperThreadMarkersOf({
        scopes: [scoped(spansOf(HELPER_TURN_TRACE))],
      });
      expect(markers.get(turnStart!.spanId)).toBe(HELPER_THREAD_ID);
      expect(markers.size).toBe(1);
    });

    it("maps nothing when the queue child is not in the batch", () => {
      const markers = codexHelperThreadMarkersOf({
        scopes: [scoped(spansOf(HELPER_TURN_TRACE, "turn/start"))],
      });
      expect(markers.size).toBe(0);
    });
  });

  describe("given the request span and its queue child under different scope entries", () => {
    /** @scenario "A codex helper request and its queue child split across scope entries still join" */
    it("joins them across the request", () => {
      const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
      const queued = spansOf(
        HELPER_TURN_TRACE,
        "app_server.serialized_request_queue",
      );
      const markers = codexHelperThreadMarkersOf({
        scopes: [
          scoped([turnStart!]),
          { scopeName: "codex_app_server", spans: queued as OtlpSpan[] },
        ],
      });
      expect(markers.get(turnStart!.spanId)).toBe(HELPER_THREAD_ID);
    });

    it("marks nothing when the request span's own scope is not codex", () => {
      const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
      const markers = codexHelperThreadMarkersOf({
        scopes: [
          { scopeName: "some_other_agent", spans: [turnStart as OtlpSpan] },
          scoped(
            spansOf(HELPER_TURN_TRACE, "app_server.serialized_request_queue"),
          ),
        ],
      });
      expect(markers.size).toBe(0);
    });
  });

  describe("given the user's own turn", () => {
    it("maps nothing, whatever the queue child names", () => {
      const markers = codexHelperThreadMarkersOf({
        scopes: [scoped(spansOf(USER_TURN_TRACE))],
      });
      expect(markers.size).toBe(0);
    });
  });
});

describe("TraceRequestCollectionService and codex helper threads", () => {
  describe("given the helper turn's request span and its queue child in one batch", () => {
    describe("when the batch is ingested", () => {
      /** @scenario "The codex helper request span is stored with its thread id" */
      it("stores the request span stamped with the helper's thread id and filters the rest", async () => {
        const { service, recordSpan } = makeService();

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
        const stored = recordedSpans(recordSpan);
        expect(stored.map((s) => s.name)).toEqual(["turn/start"]);
        expect(stored[0]!.attributes[HELPER_THREAD_ID_ATTR]).toBe(
          HELPER_THREAD_ID,
        );
        expect(stored[0]!.attributes["rpc.request_id"]).toMatch(
          /^temporary-structured-turn-/,
        );
      });

      it("stamps the request span when the exporter splits the pair over two scope entries", async () => {
        const { service, recordSpan } = makeService();
        const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
        const queued = spansOf(
          HELPER_TURN_TRACE,
          "app_server.serialized_request_queue",
        );

        await service.handleOtlpTraceRequest(
          tenantId,
          batchOf([
            { scope: fixture.scope, spans: [turnStart!] },
            { scope: fixture.scope, spans: queued },
          ]),
          piiRedactionLevel,
        );

        const stored = recordedSpans(recordSpan);
        expect(stored.map((s) => s.name)).toEqual(["turn/start"]);
        expect(stored[0]!.attributes[HELPER_THREAD_ID_ATTR]).toBe(
          HELPER_THREAD_ID,
        );
      });

      it("stamps the request span whatever order the batch lists the two in", async () => {
        const { service, recordSpan } = makeService();
        const [turnStart] = spansOf(HELPER_TURN_TRACE, "turn/start");
        const [queued] = spansOf(
          HELPER_TURN_TRACE,
          "app_server.serialized_request_queue",
        );

        await service.handleOtlpTraceRequest(
          tenantId,
          batch([turnStart!, queued!]),
          piiRedactionLevel,
        );

        expect(
          recordedSpans(recordSpan)[0]!.attributes[HELPER_THREAD_ID_ATTR],
        ).toBe(HELPER_THREAD_ID);
      });
    });
  });

  describe("given the helper's turn span in a later batch", () => {
    describe("when it is ingested", () => {
      it("stores the turn span as it came, with no stamp of its own", async () => {
        const { service, recordSpan } = makeService();

        await service.handleOtlpTraceRequest(
          tenantId,
          batch(
            spansOf(HELPER_TURN_TRACE, "session_task.turn", "handle_responses"),
          ),
          piiRedactionLevel,
        );

        const stored = recordedSpans(recordSpan);
        expect(stored.map((s) => s.name).sort()).toEqual([
          "handle_responses",
          "session_task.turn",
        ]);
        for (const span of stored) {
          expect(span.attributes[HELPER_THREAD_ID_ATTR]).toBeUndefined();
        }
      });
    });
  });

  describe("given the request span arrives without its queue child", () => {
    describe("when it is ingested", () => {
      it("filters it as the noise it is on its own", async () => {
        const { service, recordSpan } = makeService();

        await service.handleOtlpTraceRequest(
          tenantId,
          batch(spansOf(HELPER_TURN_TRACE, "turn/start")),
          piiRedactionLevel,
        );

        expect(recordSpan).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the user's own turn", () => {
    describe("when its spans are ingested", () => {
      /** @scenario "A codex turn of the user's own is not marked" */
      it("filters the request span and stores the turn span unstamped", async () => {
        const { service, recordSpan } = makeService();

        await service.handleOtlpTraceRequest(
          tenantId,
          batch(spansOf(USER_TURN_TRACE)),
          piiRedactionLevel,
        );

        const stored = recordedSpans(recordSpan);
        expect(stored.map((s) => s.name)).toEqual(["session_task.turn"]);
        expect(stored[0]!.attributes[HELPER_THREAD_ID_ATTR]).toBeUndefined();
      });
    });
  });
});
