import { describe, expect, it, vi } from "vitest";
import {
  createTraceProcessingPipeline,
  spanStorageGroupKey,
  traceCommandGroupKey,
  traceFoldGroupKey,
} from "../index";
import {
  recordSpanCommandGroupKey,
  resolveSpanCommandShardCount,
  shardIndexFor,
} from "../spanSharding";
import {
  storedSpansTable,
  traceAnalyticsTable,
  traceSummariesTable,
} from "../table";
import { canonicalSpan, createFakeClient, TRACE_ID } from "./fixtures";

const ctx = { now: Date.now(), tenantId: "tenant-1" };

describe("the trace-processing composition", () => {
  describe("given the projections this pipeline mounts", () => {
    /** @scenario "A projection declares the events it subscribes to" */
    it("declares each fold's subscribed event types", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      expect([...built.folds.traceSummary!.eventTypes].sort()).toEqual(
        [...built.eventTypes].sort(),
      );
      expect([...built.folds.traceAnalytics!.eventTypes].sort()).toEqual(
        [
          "lw.obs.trace.annotation_added",
          "lw.obs.trace.annotation_removed",
          "lw.obs.trace.annotations_bulk_synced",
          "lw.obs.trace.origin_resolved",
          "lw.obs.trace.span_received",
          "lw.obs.trace.topic_assigned",
          "lw.obs.trace.trace_name_changed",
        ].sort(),
      );
    });

    /** @scenario "A map projection declares the events it subscribes to" */
    it("declares the map's single subscribed event type", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });
      expect(built.maps.spanStorage!.eventTypes).toEqual([
        "lw.obs.trace.span_received",
      ]);
    });

    /** @scenario "An event the projection did not subscribe to leaves the state alone" */
    it("still counts an event it declares no handler for as applied, but runs no logic for it", async () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      const result = await built.folds.traceAnalytics!.apply({
        key: TRACE_ID,
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.log_contributed",
            data: { traceId: TRACE_ID, spanId: "s1" },
          },
        ],
      });

      expect(result.events).toBe(1);
    });

    /** @scenario "Skipping events" */
    it("maps nothing for an event the span store does not subscribe to", async () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      const result = await built.maps.spanStorage!.apply({
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.topic_assigned",
            data: { traceId: TRACE_ID, topicId: null },
          },
        ],
      });

      expect(result).toEqual({ written: 0 });
    });
  });

  describe("given a command", () => {
    it("stamps the pipeline's derived persisted type onto the emitted event", async () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });
      const span = canonicalSpan({ spanId: "s1" });

      const emitted = await built.commands.recordSpan!.handle(span, ctx);

      expect(emitted).toEqual([
        { type: "lw.obs.trace.span_received", data: span },
      ]);
    });

    it("rejects an input its own schema does not accept", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      expect(() =>
        built.commands.changeTraceName!.input.parse({
          traceId: TRACE_ID,
          newName: "",
          changedByUserId: null,
          changedAt: 1,
        }),
      ).toThrow();
    });
  });

  describe("given a delivery of spans", () => {
    it("writes one insert for the whole batch, not one per span", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.maps.spanStorage!.apply({
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s1" }),
          },
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s2" }),
          },
        ],
      });

      expect(result).toEqual({ written: 2 });
      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]?.table).toBe(storedSpansTable.name);
      expect(client.insertCalls[0]?.rows).toHaveLength(2);
      expect(client.insertCalls[0]?.columns).toEqual(
        storedSpansTable.columnNames,
      );
    });

    it("folds a batch into one summary row keyed by the trace", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.folds.traceSummary!.apply({
        key: TRACE_ID,
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s1" }),
          },
        ],
      });

      expect(result).toEqual({ events: 1 });
      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]?.table).toBe(traceSummariesTable.name);
    });

    it("folds a batch into one analytics row keyed by the trace", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.folds.traceAnalytics!.apply({
        key: TRACE_ID,
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s1" }),
          },
        ],
      });

      expect(result).toEqual({ events: 1 });
      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]?.table).toBe(traceAnalyticsTable.name);
    });
  });

  describe("given the dispatch lanes this pipeline uses", () => {
    /** @scenario "Sharding disabled keeps the historic trace-only group key" */
    it("keeps recordSpan on the trace's own lane while sharding is off", () => {
      expect(
        recordSpanCommandGroupKey({
          tenantId: "tenant-1",
          traceId: TRACE_ID,
          spanId: "s1",
        }),
      ).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "command", name: "recordSpan" },
        scope: {
          kind: "aggregate",
          aggregateType: "trace",
          aggregateId: TRACE_ID,
        },
      });
    });

    /** @scenario "Sharding spreads a trace's spans across groups" */
    it("splits one trace's spans across lanes once sharding is on", () => {
      const keys = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map(
        (spanId) =>
          recordSpanCommandGroupKey({
            tenantId: "tenant-1",
            traceId: TRACE_ID,
            spanId,
            shardCount: 4,
          }).scope,
      );

      const distinct = new Set(keys.map((scope) => JSON.stringify(scope)));
      expect(distinct.size).toBeGreaterThan(1);
      for (const scope of keys) {
        expect(scope).toMatchObject({ kind: "partition" });
      }
    });

    /** @scenario "A span always maps to the same shard" */
    it("sends the same span id to the same shard every time", () => {
      expect(shardIndexFor("span-abc", 16)).toBe(shardIndexFor("span-abc", 16));
      expect(shardIndexFor("span-abc", 16)).toBeLessThan(16);
    });

    /** @scenario "The configured shard count is clamped to a safe range" */
    it("clamps an unusable shard count down to disabled", () => {
      expect(resolveSpanCommandShardCount(undefined)).toBe(1);
      expect(resolveSpanCommandShardCount("0")).toBe(1);
      expect(resolveSpanCommandShardCount("-4")).toBe(1);
      expect(resolveSpanCommandShardCount("not-a-number")).toBe(1);
      expect(resolveSpanCommandShardCount("1000")).toBe(128);
      expect(resolveSpanCommandShardCount("8")).toBe(8);
    });

    /** @scenario "The pipeline shards the command while leaving the fold per-trace" */
    it("keeps both folds on one lane per trace however the command shards", () => {
      const summaryLane = traceFoldGroupKey({
        tenantId: "tenant-1",
        projection: "traceSummary",
        traceId: TRACE_ID,
      });
      const analyticsLane = traceFoldGroupKey({
        tenantId: "tenant-1",
        projection: "traceAnalytics",
        traceId: TRACE_ID,
      });

      expect(summaryLane.scope).toEqual({
        kind: "aggregate",
        aggregateType: "trace",
        aggregateId: TRACE_ID,
      });
      expect(analyticsLane.scope).toEqual(summaryLane.scope);
      expect(analyticsLane.lane).not.toEqual(summaryLane.lane);
    });

    it("puts each stored span on its own lane, so nothing serialises them", () => {
      expect(
        spanStorageGroupKey({ tenantId: "tenant-1", eventId: "evt-1" }),
      ).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "map", name: "spanStorage" },
        scope: { kind: "event", eventId: "evt-1" },
      });
    });

    it("puts every other command on the trace's own lane", () => {
      expect(
        traceCommandGroupKey({
          tenantId: "tenant-1",
          command: "assignTopic",
          traceId: TRACE_ID,
        }),
      ).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "command", name: "assignTopic" },
        scope: {
          kind: "aggregate",
          aggregateType: "trace",
          aggregateId: TRACE_ID,
        },
      });
    });
  });

  describe("given the members ADR-107's audit found dropped", () => {
    const processCtx = { ...ctx, processKey: TRACE_ID };
    /** A fresh span, timed close to `ctx.now` — the fixture's own default
     * `occurredAt: 1_000` reads as hours stale against a wall-clock `ctx.now`. */
    const freshSpan = (overrides: Parameters<typeof canonicalSpan>[0] = {}) =>
      canonicalSpan({ occurredAt: ctx.now, ...overrides });

    /** @scenario a span with no origin evidence arms the fallback deadline, and the wake dispatches it */
    it("originGate arms a deadline on an un-attributed span and fires resolveOrigin on wake", async () => {
      const resolveOrigin = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        originGate: { resolveOrigin },
      });

      const step = built.processManagers.originGate!.evolve(
        built.processManagers.originGate!.init(),
        {
          type: "lw.obs.trace.span_received",
          data: freshSpan({ spanId: "s1" }),
        },
        processCtx,
      );
      expect(step?.nextWakeAt).not.toBeNull();

      const wake = built.processManagers.originGate!.onWake!(
        step!.state,
        processCtx,
      );
      expect(wake.intents).toEqual([
        {
          type: "originGate/resolveOrigin",
          payload: { tenantId: "tenant-1", traceId: TRACE_ID },
        },
      ]);

      await built.processManagers.originGate!.intents.resolveOrigin!.deliver(
        { tenantId: "tenant-1", traceId: TRACE_ID },
        ctx,
      );
      expect(resolveOrigin).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        traceId: TRACE_ID,
        origin: "application",
        reason: "deferred_fallback",
      });
    });

    /** @scenario a span never re-arms a gate that already resolved */
    it("originGate never mounts without deps.originGate", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });
      expect(built.processManagers.originGate).toBeUndefined();
    });

    /** @scenario a message arms the quiet-period deadline, and the wake asks the injected port for an evaluation */
    it("evaluationTrigger arms a deadline on a message and dispatches to every enabled monitor on wake", async () => {
      const requestEvaluation = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        evaluationTrigger: {
          isCausalityLoopGuardDisabled: async () => false,
          readTraceSummary: async () => ({
            spanCount: 1,
            blockedByGuardrail: false,
            computedOutput: null,
            attributes: { "langwatch.origin": "application" },
          }),
          getEnabledOnMessageMonitors: async () => [
            { id: "mon-1", checkType: "custom", name: "Monitor 1" },
          ],
          requestEvaluation,
        },
      });

      const step = built.processManagers.evaluationTrigger!.evolve(
        built.processManagers.evaluationTrigger!.init(),
        {
          type: "lw.obs.trace.span_received",
          data: freshSpan({ spanId: "s1" }),
        },
        processCtx,
      );
      expect(step?.nextWakeAt).not.toBeNull();

      const wake = built.processManagers.evaluationTrigger!.onWake!(
        step!.state,
        processCtx,
      );
      expect(wake.intents).toHaveLength(1);

      const payload = wake.intents[0]!.payload as Record<string, unknown>;
      await built.processManagers.evaluationTrigger!.intents.requestEvaluations!.deliver(
        payload,
        ctx,
      );
      expect(requestEvaluation).toHaveBeenCalledTimes(1);
      expect(requestEvaluation.mock.calls[0]![0]).toMatchObject({
        tenantId: "tenant-1",
        traceId: TRACE_ID,
        monitor: { id: "mon-1" },
      });
    });

    /** @scenario a loop-guarded request dispatches nothing */
    it("evaluationTrigger declines a request whose every span came out of an evaluator", async () => {
      const requestEvaluation = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        evaluationTrigger: {
          isCausalityLoopGuardDisabled: async () => false,
          readTraceSummary: async () => {
            throw new Error("must not be read once the loop guard declines");
          },
          getEnabledOnMessageMonitors: async () => [],
          requestEvaluation,
        },
      });

      await built.processManagers.evaluationTrigger!.intents.requestEvaluations!.deliver(
        {
          tenantId: "tenant-1",
          traceId: TRACE_ID,
          occurredAt: 1_000,
          requestGeneration: 0,
          pendingEligibleSpanCount: 0,
          evaluatorEmittedSpanCount: 3,
        },
        ctx,
      );
      expect(requestEvaluation).not.toHaveBeenCalled();
    });

    /** @scenario a span carrying a custom evaluation fires the report intent immediately, with no deadline */
    it("customEvaluationSync reports a span's SDK-run evaluations with no wait", async () => {
      const reportEvaluation = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        customEvaluationSync: {
          getSpanEvaluations: async () => [
            {
              name: "my-eval",
              evaluationId: null,
              evaluatorId: null,
              isGuardrail: null,
              status: null,
              passed: true,
              score: 1,
              label: null,
              details: null,
              costId: null,
              errorMessage: null,
              errorDetails: null,
            },
          ],
          reportEvaluation,
        },
      });

      const span = freshSpan({
        spanId: "s1",
        events: [
          {
            name: "langwatch.evaluation.custom",
            timeUnixMs: 1_000,
            attributes: { json_encoded_event: "{}" },
          },
        ],
      });
      const step = built.processManagers.customEvaluationSync!.evolve(
        built.processManagers.customEvaluationSync!.init(),
        { type: "lw.obs.trace.span_received", data: span },
        processCtx,
      );
      expect(step?.nextWakeAt).toBeNull();
      expect(step?.intents).toHaveLength(1);

      const payload = step!.intents[0]!.payload as Record<string, unknown>;
      await built.processManagers.customEvaluationSync!.intents.reportEvaluations!.deliver(
        payload,
        ctx,
      );
      expect(reportEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluatorName: "my-eval",
          passed: true,
          score: 1,
        }),
      );
    });

    /** @scenario the busiest billable stream pokes the injected billing port */
    it("billingMeterPoke forwards spanReceived to the injected port", async () => {
      const handle = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        billingPoke: { handle },
      });

      await built.subscribers.billingMeterPoke!.handle(
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({ spanId: "s1" }),
        },
        ctx,
      );
      expect(handle).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    });

    /** @scenario trace activity nudges every active graph trigger to re-evaluate */
    it("graphTriggerActivity evaluates every active graph trigger on a span", async () => {
      const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        graphTriggerActivity: {
          getActiveGraphTriggers: async () => [{ id: "trig-1" }],
          evaluateGraphTrigger,
        },
      });

      await built.subscribers.graphTriggerActivity!.handle(
        {
          type: "lw.obs.trace.span_received",
          data: freshSpan({ spanId: "s1" }),
        },
        ctx,
      );
      expect(evaluateGraphTrigger).toHaveBeenCalledWith({
        triggerId: "trig-1",
        tenantId: "tenant-1",
        reason: "real-time",
      });
    });

    /** @scenario a coding-agent span dispatches its lifted facts into the session pipeline */
    it("codingAgentSpanFactsDispatch contributes facts for a recognised agent span", async () => {
      const contributeSpanFacts = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        codingAgentSpanFacts: {
          contributeSpanFacts,
          detection: {
            resolveConversationKey: () => "session-key",
            detectAgent: () => "claude_code",
            isCodingAgentSpanName: () => true,
            liftSpanFacts: () => ({}),
            liftLogFacts: () => null,
            isCodingAgentMetricName: () => false,
            liftMetricAttributes: () => ({}),
          },
        },
      });

      await built.subscribers.codingAgentSpanFactsDispatch!.handle(
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({ spanId: "s1" }),
        },
        ctx,
      );
      expect(contributeSpanFacts).toHaveBeenCalledTimes(1);
      expect(contributeSpanFacts.mock.calls[0]![0]).toMatchObject({
        traceId: TRACE_ID,
        agent: "claude_code",
      });
    });

    /** @scenario a project's first real ingest completes onboarding */
    it("projectMetadata marks a project onboarded on its first real ingest", async () => {
      const updateMetadata = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        projectMetadata: {
          getById: async () => ({ firstMessage: false, integrated: false }),
          updateMetadata,
        },
      });

      await built.subscribers.projectMetadata!.handle(
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({
            spanId: "s1",
            resourceAttributes: { "telemetry.sdk.language": "python" },
          }),
        },
        ctx,
      );
      expect(updateMetadata).toHaveBeenCalledWith({
        id: "tenant-1",
        data: { firstMessage: true, integrated: true, language: "python" },
      });
    });

    /** @scenario a seeded sample trace never completes onboarding */
    it("projectMetadata ignores a seeded sample trace", async () => {
      const updateMetadata = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        projectMetadata: {
          getById: async () => ({ firstMessage: false, integrated: false }),
          updateMetadata,
        },
      });

      await built.subscribers.projectMetadata!.handle(
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({
            spanId: "s1",
            attributes: { "langwatch.origin": "sample" },
          }),
        },
        ctx,
      );
      expect(updateMetadata).not.toHaveBeenCalled();
    });

    /** @scenario every real ingest re-asserts the project's clustering schedule */
    it("topicClusteringBootstrap re-asserts the schedule on every real ingest", async () => {
      const bootstrap = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        bootstrapTopicClustering: bootstrap,
      });

      await built.subscribers.topicClusteringBootstrap!.handle(
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({ spanId: "s1" }),
        },
        ctx,
      );
      expect(bootstrap).toHaveBeenCalledWith("tenant-1");
    });

    /** @scenario a span push and a summary push use distinct SSE event names */
    it("broadcasts a span-stored nudge and a trace-summary nudge distinctly", async () => {
      const broadcastToTenant = vi.fn().mockResolvedValue(undefined);
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
        broadcast: { broadcastToTenant },
      });

      await built.subscribers.spanStorageBroadcast!.handle(
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({ spanId: "s1" }),
        },
        ctx,
      );
      await built.subscribers.traceUpdateBroadcast!.handle(
        {
          type: "lw.obs.trace.origin_resolved",
          data: { traceId: TRACE_ID, origin: "application", reason: "x" },
        },
        ctx,
      );

      expect(broadcastToTenant).toHaveBeenNthCalledWith(
        1,
        "tenant-1",
        JSON.stringify({ event: "span_stored", traceId: TRACE_ID }),
        "trace_updated",
      );
      expect(broadcastToTenant).toHaveBeenNthCalledWith(
        2,
        "tenant-1",
        JSON.stringify({ event: "trace_summary_updated", traceId: TRACE_ID }),
        "trace_updated",
      );
    });

    /** @scenario the five enterprise members mount only when the composition root injects them */
    it("mounts every enterprise member behind its own deps flag, and none without it", () => {
      const withoutEe = createTraceProcessingPipeline({
        client: createFakeClient(),
      });
      expect(withoutEe.subscribers.traceAlertTriggerMatch).toBeUndefined();
      expect(withoutEe.maps.gatewayBudgetDebits).toBeUndefined();

      const traceAlertTriggerMatch = {
        name: "traceAlertTriggerMatch",
        eventTypes: [],
        handle: vi.fn(),
      };
      const gatewayBudgetDebits = {
        map: {
          name: "gatewayBudgetDebits",
          eventTypes: [],
          apply: vi.fn().mockResolvedValue({ written: 0 }),
        },
        mount: {
          projection: "map",
          store: "append",
          scope: "aggregate",
          collapse: "none",
        } as const,
      };
      const withEe = createTraceProcessingPipeline({
        client: createFakeClient(),
        ee: { traceAlertTriggerMatch, gatewayBudgetDebits },
      });
      expect(withEe.subscribers.traceAlertTriggerMatch).toBe(
        traceAlertTriggerMatch,
      );
      expect(withEe.maps.gatewayBudgetDebits).toBeDefined();
    });
  });
});
