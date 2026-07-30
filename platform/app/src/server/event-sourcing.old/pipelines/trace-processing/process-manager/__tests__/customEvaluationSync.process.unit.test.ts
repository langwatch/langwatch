import { describe, expect, it } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import {
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  buildProcessEventView,
  CUSTOM_EVALUATION_SYNC_ENQUEUE,
  handleSpanReceived,
  spanCarriesCustomEvaluations,
} from "../customEvaluationSync.process";
import {
  CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
  CUSTOM_EVALUATION_SPAN_EVENT_NAME,
  type CustomEvaluationSyncEventView,
  INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
  reportEvaluationsMessageKey,
} from "../customEvaluationSyncProcess.types";

const TRACE_ID = "trace-1";
const SPAN_ID = "bbbb000000000001";
const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;
const SPAN_STARTED_AT = NOW - 1_000;

type Intents = Parameters<typeof handleSpanReceived>[2]["intents"];

function makeCtx(
  overrides: {
    at?: number;
    now?: number;
    key?: string;
    projectId?: string;
  } = {},
): ProcessHandlerContext<any> {
  return {
    at: overrides.at ?? NOW,
    now: overrides.now ?? NOW,
    key: overrides.key ?? TRACE_ID,
    projectId: overrides.projectId ?? PROJECT_ID,
    intents: {
      reportEvaluations: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "reportEvaluations",
        payload,
      }),
    } as unknown as Intents,
  };
}

function view(
  overrides: Partial<CustomEvaluationSyncEventView> = {},
): CustomEvaluationSyncEventView {
  return {
    spanId: SPAN_ID,
    spanStartedAt: SPAN_STARTED_AT,
    hasCustomEvaluations: true,
    ...overrides,
  };
}

/**
 * A span carrying whatever the SDK wrote as its evaluation events. Payloads
 * are handed in raw so a malformed one can be expressed.
 */
function spanEvent(
  options: {
    payloads?: unknown[];
    spanEvents?: unknown;
    spanId?: unknown;
    startTimeUnixNano?: unknown;
    spanAttributes?: unknown[];
  } = {},
): TraceProcessingEvent {
  const events =
    options.spanEvents ??
    (options.payloads ?? []).map((payload) => ({
      timeUnixNano: "1700000000500000000",
      name: CUSTOM_EVALUATION_SPAN_EVENT_NAME,
      attributes: [
        {
          key: CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
          value: {
            stringValue:
              typeof payload === "string" ? payload : JSON.stringify(payload),
          },
        },
      ],
    }));

  return {
    id: "event-1",
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: PROJECT_ID,
    createdAt: NOW,
    occurredAt: NOW,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {
      span: {
        traceId: TRACE_ID,
        spanId: "spanId" in options ? options.spanId : SPAN_ID,
        parentSpanId: null,
        name: "chat",
        startTimeUnixNano:
          "startTimeUnixNano" in options
            ? options.startTimeUnixNano
            : String(SPAN_STARTED_AT * 1_000_000),
        attributes: options.spanAttributes ?? [],
        events,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: SPAN_ID, traceId: TRACE_ID },
  } as unknown as TraceProcessingEvent;
}

describe("customEvaluationSync process", () => {
  describe("given a span carrying evaluations the SDK ran itself", () => {
    it("asks for them to be reported", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx(),
      );

      expect(result.intents).toHaveLength(1);
      expect(result.intents?.[0]?.payload).toEqual({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        occurredAt: NOW,
        spanStartedAt: SPAN_STARTED_AT,
      });
    });

    it("carries no verdict of its own", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx(),
      );

      // The outbox row holds identities; the verdicts are read back from the
      // span store at dispatch time.
      expect(Object.keys(result.intents?.[0]?.payload as object)).toEqual([
        "tenantId",
        "traceId",
        "spanId",
        "occurredAt",
        "spanStartedAt",
      ]);
    });

    it("asks as the span is handled rather than after a wait", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx(),
      );

      expect(result.nextWakeAt).toBeNull();
    });

    it("stamps the instant the span happened", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ at: NOW - 4_000, now: NOW }),
      );

      expect(
        (result.intents?.[0]?.payload as { occurredAt: number }).occurredAt,
      ).toBe(NOW - 4_000);
    });

    it("windows the read-back on the span's own start, not on ingest", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ at: NOW, now: NOW + 60_000 }),
      );

      // A span that ran longer than the store's partition window and exported
      // on end is permanently invisible to an ingest-centered read.
      expect(
        (result.intents?.[0]?.payload as { spanStartedAt: number })
          .spanStartedAt,
      ).toBe(SPAN_STARTED_AT);
    });

    it("keeps no state at all", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx(),
      );

      // Nothing is decided over time, so there is nothing to accumulate. The
      // work is identified by the span, not by a counter.
      expect(result.state).toEqual({});
    });
  });

  describe("the identity of one report", () => {
    it("addresses a span by the same key every time", () => {
      const first = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx(),
      );
      const repeat = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ now: NOW + 5_000 }),
      );

      // Derived from the work, never minted (ADR-098) — which is what lets the
      // outbox collapse a duplicate without a generation counter to keep.
      expect(first.intents?.[0]?.messageKey).toBe(
        reportEvaluationsMessageKey(TRACE_ID, SPAN_ID),
      );
      expect(repeat.intents?.[0]?.messageKey).toBe(
        first.intents?.[0]?.messageKey,
      );
    });

    it("gives the trace's next reporting span its own key", () => {
      const first = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx(),
      );
      const second = handleSpanReceived(
        first.state,
        view({ spanId: "bbbb000000000002" }),
        makeCtx({ at: NOW + 1_000, now: NOW + 1_000 }),
      );

      expect(second.intents?.[0]?.messageKey).not.toBe(
        first.intents?.[0]?.messageKey,
      );
    });
  });

  describe("given an ordinary span", () => {
    it("asks for nothing", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view({ hasCustomEvaluations: false }),
        makeCtx(),
      );

      // Without this the claim-check would cost every span in the project an
      // outbox row and a ClickHouse read to discover it had nothing to report.
      expect(result.intents ?? []).toEqual([]);
    });
  });

  describe("given a span that carried verdicts but cannot be referenced", () => {
    it("asks for nothing when it has no span id", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view({ spanId: null }),
        makeCtx(),
      );

      expect(result.intents ?? []).toEqual([]);
    });

    it("asks for nothing when it has no start to window the read on", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view({ spanStartedAt: null }),
        makeCtx(),
      );

      expect(result.intents ?? []).toEqual([]);
    });
  });

  describe("given the subscriber is backed up", () => {
    it("still reports a span that was merely late", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ at: NOW - 20_000, now: NOW }),
      );

      expect(result.intents).toHaveLength(1);
    });

    it("asks for nothing on a resync flood", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ at: NOW - STALE_TRACE_THRESHOLD_MS - 1, now: NOW }),
      );

      // Deliberate, and the visible edge of the classification question: this
      // is correct for dispatched work and wrong for derived state, which is
      // what a relay of an already-durable fact actually is.
      expect(result.intents ?? []).toEqual([]);
    });
  });

  describe("given a trace with no id", () => {
    it("asks for nothing", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ key: "" }),
      );

      expect(result.intents ?? []).toEqual([]);
    });
  });

  describe("given no project to address the report at", () => {
    it("asks for nothing", () => {
      const result = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        view(),
        makeCtx({ projectId: "" }),
      );

      expect(result.intents ?? []).toEqual([]);
    });
  });

  describe("the content boundary", () => {
    it("hands on the span's identity and nothing else", () => {
      const result = buildProcessEventView(
        spanEvent({ payloads: [{ name: "toxicity", score: 0.1 }] }),
      );

      expect(result).toEqual({
        spanId: SPAN_ID,
        spanStartedAt: SPAN_STARTED_AT,
        hasCustomEvaluations: true,
      });
    });

    it("keeps the verdict itself out of the persisted view", () => {
      const result = buildProcessEventView(
        spanEvent({
          payloads: [
            { name: "toxicity", details: "the customer's private reasoning" },
          ],
        }),
      );

      expect(JSON.stringify(result)).not.toContain("private reasoning");
    });

    it("keeps span payload out of the persisted view", () => {
      const result = buildProcessEventView(
        spanEvent({
          payloads: [{ name: "toxicity" }],
          spanAttributes: [
            { key: "gen_ai.prompt", value: { stringValue: "the secret" } },
          ],
        }),
      );

      expect(JSON.stringify(result)).not.toContain("the secret");
    });

    it("reads an ordinary span as carrying no evaluations", () => {
      const result = buildProcessEventView(spanEvent({ payloads: [] }));

      expect(result.hasCustomEvaluations).toBe(false);
    });

    it("ignores span events that are not evaluations", () => {
      const result = buildProcessEventView(
        spanEvent({
          spanEvents: [
            {
              timeUnixNano: "1700000000500000000",
              name: "exception",
              attributes: [
                {
                  key: CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
                  value: { stringValue: '{"name":"toxicity"}' },
                },
              ],
            },
          ],
        }),
      );

      expect(result.hasCustomEvaluations).toBe(false);
    });

    it("does not parse the payload to decide a span is worth reading back", () => {
      const result = buildProcessEventView(
        spanEvent({ payloads: ["not json at all"] }),
      );

      // The presence check runs on every span in the project. Parsing here
      // would put attacker-supplied JSON on that path; the parse belongs in
      // the handler, against the payload read back from the store.
      expect(result.hasCustomEvaluations).toBe(true);
    });

    it("reads an empty payload attribute as no evaluation", () => {
      const result = buildProcessEventView(spanEvent({ payloads: [""] }));

      expect(result.hasCustomEvaluations).toBe(false);
    });

    it("refuses to reference a span with no id", () => {
      const result = buildProcessEventView(
        spanEvent({ payloads: [{ name: "toxicity" }], spanId: null }),
      );

      expect(result.spanId).toBeNull();
      expect(result.spanStartedAt).toBeNull();
    });

    it("refuses to reference a span with no parseable start", () => {
      const result = buildProcessEventView(
        spanEvent({
          payloads: [{ name: "toxicity" }],
          startTimeUnixNano: "not a number",
        }),
      );

      expect(result.spanStartedAt).toBeNull();
    });

    it("reads a malformed span as carrying nothing rather than throwing", () => {
      const result = buildProcessEventView({
        type: SPAN_RECEIVED_EVENT_TYPE,
        data: { span: { events: "not an array" } },
      } as unknown as TraceProcessingEvent);

      // A throw here is a delivery failure on an event the process cannot
      // skip, which parks the trace's group rather than dropping one verdict.
      expect(result.hasCustomEvaluations).toBe(false);
    });

    it("reads an event with no span at all as carrying nothing", () => {
      const result = buildProcessEventView({
        type: SPAN_RECEIVED_EVENT_TYPE,
        data: {},
      } as unknown as TraceProcessingEvent);

      expect(result.hasCustomEvaluations).toBe(false);
    });
  });

  describe("given every process is restarted before the report is dispatched", () => {
    it("still asks, and still addresses the same span", () => {
      const reporting = handleSpanReceived(
        INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
        buildProcessEventView(
          spanEvent({ payloads: [{ name: "toxicity", score: 0.1 }] }),
        ),
        makeCtx(),
      );

      // The restart: everything in memory is gone, and the process comes back
      // from the row it committed — which is JSON, not a live object.
      const rehydrated = JSON.parse(JSON.stringify(reporting.intents?.[0]));

      expect(rehydrated.messageKey).toBe(
        reportEvaluationsMessageKey(TRACE_ID, SPAN_ID),
      );
      expect(rehydrated.payload).toEqual({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        occurredAt: NOW,
        spanStartedAt: SPAN_STARTED_AT,
      });
    });
  });
  describe("given a project whose spans carry no custom evaluation", () => {
    it("stages no job at all, so an ordinary span costs nothing", () => {
      // The regression this closes: the gate was the reactor's `shouldReact`
      // and moved into the handler, so EVERY span in the project minted a
      // GroupQueue job, a `ProcessManagerInbox` row and an empty process
      // instance to discover it had nothing to report.
      expect(CUSTOM_EVALUATION_SYNC_ENQUEUE.filter).toBe(
        spanCarriesCustomEvaluations,
      );
      expect(spanCarriesCustomEvaluations(spanEvent())).toBe(false);
    });

    it("stages a job for a span that does carry one", () => {
      expect(
        spanCarriesCustomEvaluations(
          spanEvent({ payloads: [{ name: "toxicity", passed: true }] }),
        ),
      ).toBe(true);
    });

    it("declines a span event that names the right thing but carries no payload", () => {
      expect(
        spanCarriesCustomEvaluations(
          spanEvent({
            spanEvents: [
              { name: CUSTOM_EVALUATION_SPAN_EVENT_NAME, attributes: [] },
            ],
          }),
        ),
      ).toBe(false);
    });

    it("stays total against a span it cannot make sense of", () => {
      // The filter runs at the routing seam, which has no retry: a throw there
      // loses this process's job for the event permanently (ADR-098).
      const malformed = {
        ...spanEvent(),
        data: { span: { events: "not-an-array" } },
      } as unknown as TraceProcessingEvent;

      expect(() => spanCarriesCustomEvaluations(malformed)).not.toThrow();
      expect(spanCarriesCustomEvaluations(malformed)).toBe(false);
    });

    it("collapses nothing, because each span's verdicts are their own work", () => {
      expect(CUSTOM_EVALUATION_SYNC_ENQUEUE.deduplication).toBeUndefined();
    });
  });
});
