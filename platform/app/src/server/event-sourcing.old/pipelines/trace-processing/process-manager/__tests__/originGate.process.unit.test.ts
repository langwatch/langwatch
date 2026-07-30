import { describe, expect, it } from "vitest";

import { buildProcessManager } from "~/server/event-sourcing.old/pipeline/processBuilder";
import type { ProcessHandlerContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import type {
  ProcessEventEnvelope,
  ProcessRef,
} from "~/server/event-sourcing.old/process-manager/processManager.types";
import { buildProcessDefinition } from "~/server/event-sourcing.old/process-manager/processRuntime";

import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  buildProcessEventView,
  handleOriginResolved,
  handleTraceActivity,
  originGatePM,
  originGateWake,
} from "../originGate.process";
import {
  INITIAL_ORIGIN_GATE_STATE,
  ORIGIN_GATE_DEADLINE_MS,
  ORIGIN_GATE_ENQUEUE_WINDOW_MS,
  ORIGIN_GATE_PROCESS_NAME,
  type OriginGateEventView,
  type OriginGateState,
} from "../originGateProcess.types";

const TRACE_ID = "trace-1";
const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;

type Intents = Parameters<typeof originGateWake>[1]["intents"];

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
      resolveOrigin: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "resolveOrigin",
        payload,
      }),
    } as unknown as Intents,
  };
}

/** A trace that has told us nothing about where it came from. */
const NO_EVIDENCE: OriginGateEventView = {
  originDecided: false,
  isRootSpan: false,
  sdkPresent: false,
};

function armed(overrides: Partial<OriginGateState> = {}): OriginGateState {
  return {
    ...INITIAL_ORIGIN_GATE_STATE,
    deadlineAt: NOW + ORIGIN_GATE_DEADLINE_MS,
    ...overrides,
  };
}

function attribute(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

function spanEvent(
  overrides: {
    spanAttributes?: unknown[];
    resourceAttributes?: unknown[];
    scopeName?: string;
    parentSpanId?: string | null;
  } = {},
): TraceProcessingEvent {
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
        spanId: "span-1",
        parentSpanId: overrides.parentSpanId ?? null,
        name: "chat",
        attributes: overrides.spanAttributes ?? [],
      },
      resource:
        overrides.resourceAttributes !== undefined
          ? { attributes: overrides.resourceAttributes }
          : null,
      instrumentationScope: overrides.scopeName
        ? { name: overrides.scopeName }
        : null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: TRACE_ID },
  } as unknown as TraceProcessingEvent;
}

describe("originGate process", () => {
  describe("given a trace that says nothing about where it came from", () => {
    it("arms the fallback deadline on the first span", () => {
      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        NO_EVIDENCE,
        makeCtx(),
      );

      expect(result.nextWakeAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);
      expect(result.state.deadlineAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);
    });

    it("restates the same deadline as later spans arrive", () => {
      const first = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        NO_EVIDENCE,
        makeCtx(),
      );

      const second = handleTraceActivity(
        first.state,
        NO_EVIDENCE,
        makeCtx({ at: NOW + 90_000, now: NOW + 90_000 }),
      );

      // A long trace's later spans must not keep pushing the fallback out,
      // and returning nothing would CLEAR the wake rather than leave it.
      expect(second.nextWakeAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);
    });

    it("emits nothing until the deadline fires", () => {
      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        NO_EVIDENCE,
        makeCtx(),
      );

      expect(result.intents ?? []).toEqual([]);
    });
  });

  describe("given the subscriber is backed up", () => {
    it("schedules from now, not from the event's own instant", () => {
      const lagged = makeCtx({ at: NOW - 120_000, now: NOW });

      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        NO_EVIDENCE,
        lagged,
      );

      // Scheduling from `at` would write a deadline two minutes closer than
      // the trace's own grace period, firing against a trace whose spans are
      // still arriving.
      expect(result.nextWakeAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);
    });

    it("arms nothing for a resync flood", () => {
      const resync = makeCtx({
        at: NOW - STALE_TRACE_THRESHOLD_MS - 1,
        now: NOW,
      });

      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        NO_EVIDENCE,
        resync,
      );

      expect(result.nextWakeAt).toBeNull();
      expect(result.state.deadlineAt).toBeNull();
    });

    it("leaves an already-armed deadline alone when a resync event arrives", () => {
      const resync = makeCtx({
        at: NOW - STALE_TRACE_THRESHOLD_MS - 1,
        now: NOW,
      });

      const result = handleTraceActivity(armed(), NO_EVIDENCE, resync);

      expect(result.nextWakeAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);
    });
  });

  describe("given a trace that names where it came from", () => {
    it("never arms a deadline", () => {
      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        { ...NO_EVIDENCE, originDecided: true },
        makeCtx(),
      );

      expect(result.nextWakeAt).toBeNull();
      expect(result.state.resolved).toBe(true);
    });

    it("closes the gate for a root span carrying an SDK marker", () => {
      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        { originDecided: false, isRootSpan: true, sdkPresent: true },
        makeCtx(),
      );

      expect(result.nextWakeAt).toBeNull();
      expect(result.state.resolved).toBe(true);
    });

    it("closes the gate when the root span follows a child that named the SDK", () => {
      // The fold resolves from the TRACE's accumulated attributes, so a root
      // span arriving after an SDK-marked child still resolves. Reading one
      // span at a time would miss it and write a needless fallback.
      const child = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        { originDecided: false, isRootSpan: false, sdkPresent: true },
        makeCtx(),
      );

      const root = handleTraceActivity(
        child.state,
        { originDecided: false, isRootSpan: true, sdkPresent: false },
        makeCtx({ at: NOW + 100, now: NOW + 100 }),
      );

      expect(child.nextWakeAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);
      expect(root.nextWakeAt).toBeNull();
    });

    it("does not resolve on an SDK marker alone", () => {
      // sdk.name is a resource attribute, identical on every span of the
      // trace. Reading it off a child would flip origin to "application" on
      // traces whose platform span has not arrived yet.
      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        { originDecided: false, isRootSpan: false, sdkPresent: true },
        makeCtx(),
      );

      expect(result.nextWakeAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);
    });
  });

  describe("when the origin resolves during the grace period", () => {
    it("clears the armed deadline", () => {
      const result = handleOriginResolved(armed(), NO_EVIDENCE, makeCtx());

      expect(result.nextWakeAt).toBeNull();
      expect(result.state.resolved).toBe(true);
    });

    it("writes nothing when a wake fires against it anyway", () => {
      const resolved = handleOriginResolved(armed(), NO_EVIDENCE, makeCtx());

      const woken = originGateWake(resolved.state, makeCtx());

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });

    it("is not re-armed by a straggling span", () => {
      const resolved = handleOriginResolved(armed(), NO_EVIDENCE, makeCtx());

      const straggler = handleTraceActivity(
        resolved.state,
        NO_EVIDENCE,
        makeCtx({ at: NOW + 1000, now: NOW + 1000 }),
      );

      expect(straggler.nextWakeAt).toBeNull();
    });
  });

  describe("when the deadline fires", () => {
    it("writes the fallback origin", () => {
      const woken = originGateWake(armed(), makeCtx());

      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.payload).toEqual({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
      });
    });

    it("clears its own deadline so it cannot fire twice", () => {
      const woken = originGateWake(armed(), makeCtx());

      expect(woken.nextWakeAt).toBeNull();
      expect(woken.state.resolved).toBe(true);

      const second = originGateWake(woken.state, makeCtx());
      expect(second.intents ?? []).toEqual([]);
    });

    it("addresses the write by the same key every time", () => {
      const first = originGateWake(armed(), makeCtx());
      const second = originGateWake(armed(), makeCtx({ now: NOW + 5000 }));

      // A stable message key is what lets the outbox collapse a duplicate.
      expect(first.intents?.[0]?.messageKey).toBe(
        second.intents?.[0]?.messageKey,
      );
    });

    /** @scenario "Deferred check deduplicates per trace" */
    it("writes one fallback however many span batches the trace arrived in", () => {
      // Every batch of a pure-OTEL trace finds no origin, and its predecessor
      // scheduled a deferred job per dispatch and leaned on a queue dedup key
      // to collapse them. Here the trace has ONE instance with ONE deadline,
      // so there is nothing to collapse.
      let state = INITIAL_ORIGIN_GATE_STATE;
      const deadlines: (number | null | undefined)[] = [];

      for (let batch = 0; batch < 4; batch++) {
        const evolution = handleTraceActivity(
          state,
          NO_EVIDENCE,
          makeCtx({ at: NOW + batch * 1_000, now: NOW + batch * 1_000 }),
        );
        state = evolution.state;
        deadlines.push(evolution.nextWakeAt);
      }

      const woken = originGateWake(state, makeCtx({ now: NOW + 4_000 }));
      const again = originGateWake(woken.state, makeCtx({ now: NOW + 5_000 }));

      expect(new Set(deadlines)).toEqual(
        new Set([NOW + ORIGIN_GATE_DEADLINE_MS]),
      );
      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.messageKey).toBe(`resolve-origin:${TRACE_ID}`);
      expect(again.intents ?? []).toEqual([]);
    });

    it("is not re-armed by a span that arrives after it", () => {
      const woken = originGateWake(armed(), makeCtx());

      const straggler = handleTraceActivity(
        woken.state,
        NO_EVIDENCE,
        makeCtx({ at: NOW + 1000, now: NOW + 1000 }),
      );

      // The fallback is already in the outbox; re-arming would write a
      // second one for the same trace.
      expect(straggler.nextWakeAt).toBeNull();
      expect(straggler.intents ?? []).toEqual([]);
    });
  });

  describe("given a trace with no id", () => {
    it("arms nothing", () => {
      const result = handleTraceActivity(
        INITIAL_ORIGIN_GATE_STATE,
        NO_EVIDENCE,
        makeCtx({ key: "" }),
      );

      expect(result.nextWakeAt).toBeNull();
    });

    it("clears itself instead of being re-found forever", () => {
      const woken = originGateWake(armed(), makeCtx({ key: "" }));

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });
  });

  describe("the content boundary", () => {
    it("keeps span payload out of the persisted view", () => {
      const view = buildProcessEventView(
        spanEvent({
          spanAttributes: [
            attribute("gen_ai.prompt", "the customer's private question"),
          ],
        }),
      );

      expect(view).toEqual({
        originDecided: false,
        isRootSpan: true,
        sdkPresent: false,
      });
    });

    it("reads an origin the span states outright", () => {
      const view = buildProcessEventView(
        spanEvent({ spanAttributes: [attribute("langwatch.origin", "langy")] }),
      );

      expect(view.originDecided).toBe(true);
    });

    it("reads an origin stamped on the resource by the ingest key", () => {
      const view = buildProcessEventView(
        spanEvent({
          resourceAttributes: [attribute("langwatch.origin", "coding_agent")],
        }),
      );

      expect(view.originDecided).toBe(true);
    });

    it("reads the evaluation and simulation SDK scopes", () => {
      expect(
        buildProcessEventView(spanEvent({ scopeName: "langwatch-evaluation" }))
          .originDecided,
      ).toBe(true);
      expect(
        buildProcessEventView(spanEvent({ scopeName: "@langwatch/scenario" }))
          .originDecided,
      ).toBe(true);
      expect(
        buildProcessEventView(spanEvent({ scopeName: "some.other.library" }))
          .originDecided,
      ).toBe(false);
    });

    it("treats an empty origin as no origin at all", () => {
      const view = buildProcessEventView(
        spanEvent({ spanAttributes: [attribute("langwatch.origin", "")] }),
      );

      expect(view.originDecided).toBe(false);
    });

    it("sees the SDK marker on the resource", () => {
      const view = buildProcessEventView(
        spanEvent({
          resourceAttributes: [attribute("telemetry.sdk.name", "langwatch")],
        }),
      );

      expect(view.sdkPresent).toBe(true);
    });

    it("counts a span with a parent as a child", () => {
      const view = buildProcessEventView(spanEvent({ parentSpanId: "span-0" }));

      expect(view.isRootSpan).toBe(false);
    });

    it("settles on an origin_resolved event", () => {
      const view = buildProcessEventView({
        type: ORIGIN_RESOLVED_EVENT_TYPE,
        data: { origin: "application", reason: "deferred_fallback" },
      } as unknown as TraceProcessingEvent);

      expect(view.originDecided).toBe(true);
    });

    it("survives a malformed span rather than throwing into the retry", () => {
      const view = buildProcessEventView({
        type: SPAN_RECEIVED_EVENT_TYPE,
        data: { span: { attributes: "not an array" }, resource: undefined },
      } as unknown as TraceProcessingEvent);

      expect(view).toEqual({
        originDecided: false,
        isRootSpan: true,
        sdkPresent: false,
      });
    });
  });

  describe("given every process is restarted before the deadline arrives", () => {
    /** @scenario "Work scheduled for later survives a restart" */
    it("still writes the fallback when it comes due", () => {
      const definition = buildProcessManager({
        name: ORIGIN_GATE_PROCESS_NAME,
        applier: originGatePM({ resolveOrigin: async () => undefined }),
      });
      const process = buildProcessDefinition(definition.config);
      const ref: ProcessRef = {
        processName: ORIGIN_GATE_PROCESS_NAME,
        projectId: PROJECT_ID,
        processKey: TRACE_ID,
      };
      const envelope: ProcessEventEnvelope = {
        eventId: "event-1",
        eventType: SPAN_RECEIVED_EVENT_TYPE,
        occurredAt: NOW,
        tenantId: PROJECT_ID,
        projectId: PROJECT_ID,
        processKey: TRACE_ID,
        payload: definition.config.toPayload!(spanEvent()),
      };

      const arming = process.evolve({
        previousState: process.initialState,
        input: { kind: "event", event: envelope, now: NOW },
        ref,
      });

      expect(arming.nextWakeAt).toBe(NOW + ORIGIN_GATE_DEADLINE_MS);

      // The restart: everything in memory is gone, and the process comes back
      // from the row it committed — which is JSON, not a live object.
      const rehydrated: unknown = JSON.parse(JSON.stringify(arming.state));

      const firing = process.evolve({
        previousState: rehydrated,
        input: {
          kind: "wake",
          scheduledFor: arming.nextWakeAt!,
          now: arming.nextWakeAt!,
        },
        ref,
      });

      expect(firing.intents).toHaveLength(1);
      expect(firing.intents[0]?.payload).toEqual({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
      });
      expect(firing.nextWakeAt).toBeNull();
    });

    it("does not write a fallback for a trace that resolved before the restart", () => {
      const definition = buildProcessManager({
        name: ORIGIN_GATE_PROCESS_NAME,
        applier: originGatePM({ resolveOrigin: async () => undefined }),
      });
      const process = buildProcessDefinition(definition.config);
      const ref: ProcessRef = {
        processName: ORIGIN_GATE_PROCESS_NAME,
        projectId: PROJECT_ID,
        processKey: TRACE_ID,
      };

      const resolving = process.evolve({
        previousState: process.initialState,
        input: {
          kind: "event",
          event: {
            eventId: "event-2",
            eventType: ORIGIN_RESOLVED_EVENT_TYPE,
            occurredAt: NOW,
            tenantId: PROJECT_ID,
            projectId: PROJECT_ID,
            processKey: TRACE_ID,
            payload: definition.config.toPayload!({
              type: ORIGIN_RESOLVED_EVENT_TYPE,
              data: { origin: "langy", reason: "explicit" },
            } as unknown as TraceProcessingEvent),
          },
          now: NOW,
        },
        ref,
      });

      const rehydrated: unknown = JSON.parse(JSON.stringify(resolving.state));

      const woken = process.evolve({
        previousState: rehydrated,
        input: { kind: "wake", scheduledFor: NOW, now: NOW + 60_000 },
        ref,
      });

      expect(resolving.nextWakeAt).toBeNull();
      expect(woken.intents).toEqual([]);
    });
  });

  describe("given a trace whose spans all say the same thing", () => {
    const dedupOf = () => {
      const definition = buildProcessManager({
        name: ORIGIN_GATE_PROCESS_NAME,
        applier: originGatePM({ resolveOrigin: async () => undefined }),
      });
      const dedup = definition.config.enqueue?.deduplication;
      if (typeof dedup !== "object") {
        throw new Error("expected a deduplication config");
      }
      return dedup;
    };

    /** @scenario "a burst about one subject costs deferred work one unit, not one each" */
    it("stages one job for the whole window instead of one per span", () => {
      // The regression: without an enqueue declaration a 10k-span trace cost
      // 10k jobs, 10k inbox rows and 10k durable transitions to arm one
      // deadline. The reactor this replaced deduplicated per trace for 15s.
      const dedup = dedupOf();

      expect(dedup.ttlMs).toBe(ORIGIN_GATE_ENQUEUE_WINDOW_MS);
      expect(dedup.makeId(spanEvent())).toBe(dedup.makeId(spanEvent()));
    });

    it("holds the window open past dispatch, so it is a rate bound and not an accident", () => {
      const dedup = dedupOf();

      expect(dedup.shouldSurviveDispatch).toBe(true);
      expect(dedup.extend).toBe(false);
    });
  });

  describe("given two spans of one trace that would decide differently", () => {
    const dedup = (() => {
      const definition = buildProcessManager({
        name: ORIGIN_GATE_PROCESS_NAME,
        applier: originGatePM({ resolveOrigin: async () => undefined }),
      });
      const config = definition.config.enqueue?.deduplication;
      if (typeof config !== "object") {
        throw new Error("expected a deduplication config");
      }
      return config;
    })();

    it("never collapses the span carrying the origin into a span carrying none", () => {
      // Collapsing them would arm a fallback for a trace that had already said
      // where it came from — an `origin_resolved` the fold then discards, and
      // one that re-arms the evaluation trigger's quiet period on the way past.
      expect(
        dedup.makeId(
          spanEvent({
            spanAttributes: [attribute("langwatch.origin", "langy")],
          }),
        ),
      ).not.toBe(dedup.makeId(spanEvent()));
    });

    it("never collapses the root span that closes an SDK trace into a child", () => {
      expect(
        dedup.makeId(
          spanEvent({
            parentSpanId: null,
            resourceAttributes: [
              attribute("telemetry.sdk.name", "opentelemetry"),
            ],
          }),
        ),
      ).not.toBe(dedup.makeId(spanEvent({ parentSpanId: "span-0" })));
    });

    it("keeps the trace of one project apart from the same trace id in another", () => {
      const other = {
        ...spanEvent(),
        tenantId: "project-2",
      } as TraceProcessingEvent;

      expect(dedup.makeId(other)).not.toBe(dedup.makeId(spanEvent()));
    });

    it("stays total against a span it cannot make sense of", () => {
      // `makeId` runs at the routing seam inside `queue.send`; a throw there
      // loses this process's job for the event permanently (ADR-098).
      const malformed = {
        ...spanEvent(),
        data: { span: 42, resource: "nope", instrumentationScope: 7 },
      } as unknown as TraceProcessingEvent;

      expect(() => dedup.makeId(malformed)).not.toThrow();
    });
  });
});
