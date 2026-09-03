import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { RecordSpanCommand, TraceSummarySubscriber } from "@langwatch/trace-server";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import {
  createWorkerTraceProcessingPipeline,
  WorkerTraceProcessingPipeline,
  type WorkerTraceProcessingPipelineOptions,
} from "../worker-trace-processing-pipeline.composition";

/**
 * Spec: specs/trace-processing/worker-trace-projection-runtime.feature
 * Spec: specs/trace-processing/worker-trace-pipeline-conversion.feature
 *
 * THE DEFINITION, driven through the function the installer registers. Trace
 * has converted: this process composes and mounts the pipeline, so these tests
 * assert what it REGISTERS and what a real span folds to, and read the
 * byte-frozen job registry rather than a list retyped here — a key that stops
 * being registered fails against the registry the queue routes on.
 *
 * The composition that builds the handlers behind those names is asserted in
 * `worker-trace-processing-mount.composition.unit.test.ts`.
 */

const noop = async () => {};
const noopSubscriber = { name: "evaluationTrigger", spec: { fold: "traceSummary", handler: noop } };

function options(
  overrides: Partial<WorkerTraceProcessingPipelineOptions> = {},
): WorkerTraceProcessingPipelineOptions {
  return {
    recordSpanCommand: { name: "recordSpan" } as unknown as RecordSpanCommand,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    spanAppendStore: { append: noop } as never,
    traceAnalyticsRollupAppendStore: { append: noop } as never,
    traceSummaryStore: { save: noop, load: noop } as never,
    traceAnalyticsStore: { save: noop, load: noop } as never,
    evaluationTrigger: noopSubscriber as unknown as TraceSummarySubscriber,
    customEvaluationSyncHandler: noop,
    trackedEventSyncHandler: noop,
    traceUpdateBroadcastHandler: noop,
    projectMetadataHandler: noop,
    simulationMetricsSyncHandler: noop,
    experimentMetricsSyncHandler: noop,
    automations: { triggerMatchHandler: noop, graphActivityHandler: noop },
    spanStorageBroadcastHandler: noop,
    ...overrides,
  };
}

function build(overrides: Partial<WorkerTraceProcessingPipelineOptions> = {}) {
  return createWorkerTraceProcessingPipeline({ ...options(overrides), originGateHandler: noop });
}

/** The routing keys the frozen registry lists for `trace_processing`. */
function frozenTraceRoutingKeys(): string[] {
  const registryPath = fileURLToPath(new URL("../../features/job-registry.json", import.meta.url));
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    pipelines: Array<{ name: string; jobs: string[] }>;
  };
  const pipeline = registry.pipelines.find((entry) => entry.name === "trace_processing");
  if (!pipeline) throw new Error("trace_processing is absent from the job registry");

  return pipeline.jobs;
}

/** What the built definition registers, in the registry's own key spelling. */
function registeredKeys(definition: ReturnType<typeof build>): Set<string> {
  const keys = new Set<string>();
  for (const name of definition.foldProjections.keys()) keys.add(`projection:${name}`);
  for (const name of definition.mapProjections.keys()) keys.add(`handler:${name}`);
  for (const command of definition.commands) keys.add(`command:${command.name}`);
  for (const name of definition.foldSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.mapSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.eventSubscribers.keys()) keys.add(`subscriber:${name}`);

  return keys;
}

describe("given the worker composition root and no application module", () => {
  describe("when it builds the trace processing pipeline", () => {
    /** @scenario "the pipeline is composed from packages alone" */
    it("names the pipeline the queue routes on", () => {
      expect(build().metadata.name).toBe("trace_processing");
      expect(build().aggregate.type).toBe("trace");
    });

    /**
     * The definition owns twenty-seven of the twenty-nine keys. The two it does
     * not are jobs, not registrations: `job:deferredOriginResolution` is the
     * installer's own and `job:datasetNormalize` is (g7)'s. Both are named here
     * so a key that quietly stops being registered cannot hide in a subtraction.
     *
     * @scenario "the pipeline is composed from packages alone" */
    it("registers every routing key except the two the installer owns", () => {
      const registered = registeredKeys(
        build({
          governanceKpisSync: { fold: "traceSummary", handler: noop } as never,
          governanceOcsfEventsSync: { fold: "traceSummary", handler: noop } as never,
          subscribers: [
            { name: "codingAgentSpanFactsDispatch", events: [], handler: noop } as never,
          ],
        }),
      );
      const missing = frozenTraceRoutingKeys().filter((key) => !registered.has(key));

      expect(missing).toEqual(["job:datasetNormalize", "job:deferredOriginResolution"]);
    });

    /** @scenario "the pipeline is composed from packages alone" */
    it("registers nothing the frozen registry does not list", () => {
      const frozen = new Set(frozenTraceRoutingKeys());
      const extra = [...registeredKeys(build())].filter((key) => !frozen.has(key));

      expect(extra).toEqual([]);
    });

    /**
     * The two EE governance rollups are optional in the definition and are the
     * only two of the fourteen that could be mounted as absent — and must not
     * be, because both are in the byte-frozen registry and a definition that
     * omits them stalls their work.
     *
     * @scenario "the pipeline is composed from packages alone" */
    it("leaves the two governance rollups unregistered when nobody supplies them", () => {
      const registered = registeredKeys(build());

      expect(registered.has("reactor:governanceKpisSync")).toBe(false);
      expect(registered.has("reactor:governanceOcsfEventsSync")).toBe(false);
    });
  });

  describe("when the collaborators it composed are exercised", () => {
    /** @scenario "the composed pipeline actually uses the collaborators it was given" */
    it("leans the projection payload with the harvested transform", () => {
      const prepare = build().prepareEventForProjection;
      expect(prepare).toBeDefined();

      const oversized = "x".repeat(64 * 1024 + 1024);
      const event = {
        id: "evt_1",
        type: "lw.obs.trace.span_received",
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        data: {
          span: {
            attributes: [{ key: "langwatch.input", value: { stringValue: oversized } }],
            events: [],
            links: [],
          },
          resource: null,
        },
      } as unknown as TraceProcessingEvent;

      const leaned = prepare!(event) as unknown as {
        data: { span: { attributes: Array<{ key: string; value: { stringValue: string } }> } };
      };
      const keys = leaned.data.span.attributes.map((attr) => attr.key);

      expect(keys).toContain("langwatch.reserved.eventref.langwatch.input");
    });

    /** @scenario "the composed pipeline actually uses the collaborators it was given" */
    it("prepares a payload rather than passing events through untouched", () => {
      // A composition that forgot to hand the pipeline its lean would leave the
      // seam undefined, and `@langwatch/eventing` would silently default it to
      // identity — every oversized value would then be written whole into the
      // projection with no pointer and no error.
      expect(build().prepareEventForProjection).not.toBeUndefined();
    });
  });

  describe("when a real span is folded through the composed pipeline", () => {
    /**
     * THE THREE ASSERTIONS THE SABOTAGE PASS PRODUCED. Handing the pipeline a
     * media-reference port that collects nothing, a cost port that prices
     * everything at zero, or an extraction port that finds no input or output
     * all left the definition structurally identical, so every registration
     * assertion above stayed green. Each is a customer-visible loss — a trace
     * with no thumbnails, a trace that appears free, a trace whose list row
     * shows `<empty>` — and none of them raises anything. So the fold is
     * driven for real and its output is asserted.
     */
    function foldOneSpan(definition: ReturnType<typeof build>) {
      const registered = definition.foldProjections.get("traceSummary");
      if (!registered) throw new Error("the traceSummary fold is not registered");
      const projection = registered.definition;

      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: "what is in this picture" },
            { type: "image_url", image_url: { url: "/api/files/tenant-1/img_a" } },
          ],
        },
      ];
      const event = {
        id: "evt_fold_1",
        aggregateId: "trace-1",
        aggregateType: "trace",
        tenantId: "tenant-1",
        createdAt: 1_700_000_000_000,
        occurredAt: 1_700_000_000_000,
        type: SPAN_RECEIVED_EVENT_TYPE,
        version: "2025-12-14",
        metadata: {},
        data: {
          piiRedactionLevel: "disabled",
          resource: null,
          instrumentationScope: null,
          span: {
            traceId: "trace-1",
            spanId: "span-1",
            name: "llm-call",
            kind: 1,
            startTimeUnixNano: "1700000000000000000",
            endTimeUnixNano: "1700000001000000000",
            status: {},
            events: [],
            links: [],
            droppedAttributesCount: 0,
            droppedEventsCount: 0,
            droppedLinksCount: 0,
            attributes: [
              { key: "langwatch.span.type", value: { stringValue: "llm" } },
              { key: "gen_ai.response.model", value: { stringValue: "openai/gpt-4o" } },
              { key: "gen_ai.usage.input_tokens", value: { intValue: 1000 } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: 1000 } },
              {
                key: "gen_ai.input.messages",
                value: { stringValue: JSON.stringify(messages) },
              },
              { key: "langwatch.output", value: { stringValue: "a cat" } },
            ],
          },
        },
      } as unknown as TraceProcessingEvent;

      return projection.apply(projection.init(), event) as unknown as {
        computedInput: string | null;
        computedOutput: string | null;
        totalCost: number | null;
        attributes: Record<string, unknown>;
      };
    }

    /** @scenario "the composed pipeline actually uses the collaborators it was given" */
    it("computes the trace's input and output with the extraction it composed", () => {
      const state = foldOneSpan(build());

      expect(state.computedInput).toContain("what is in this picture");
      expect(state.computedOutput).toBe("a cat");
    });

    /** @scenario "the composed pipeline actually uses the collaborators it was given" */
    it("records the media reference the summary strip renders", () => {
      const state = foldOneSpan(build());

      expect(state.attributes["langwatch.reserved.media_refs.input"]).toBe(
        '[{"kind":"image","url":"/api/files/tenant-1/img_a","role":"user"}]',
      );
    });

    /** @scenario "the composed pipeline actually uses the collaborators it was given" */
    it("prices the span with the catalog cost estimate it composed", () => {
      const state = foldOneSpan(build());

      expect(state.totalCost).toBeGreaterThan(0);
    });
  });

  describe("when the process's own modules are read", () => {
    /**
     * MOUNTED means the production composition is the caller. The staged-slice
     * assertion this replaces said the opposite — that nothing outside a test
     * reached this composition — and inverting it is the conversion. A test
     * that kept asserting "no caller" would have gone red on the change it was
     * written to guard, so it is replaced rather than deleted: what must not
     * happen now is the pipeline losing its caller and the process quietly
     * routing nothing.
     *
     * @scenario "the converted pipeline is mounted by the production composition" */
    it("is reached by the production composition and not only by its tests", () => {
      const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));
      const files: string[] = [];
      const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name.endsWith(".ts")) files.push(path);
        }
      };
      walk(sourceRoot);

      // A moved or renamed source root must fail here rather than pass on an
      // empty list.
      expect(files.length).toBeGreaterThan(50);

      const callers = files.filter(
        (file) =>
          !file.includes("__tests__") &&
          readFileSync(file, "utf8").includes("worker-trace-processing-pipeline.composition"),
      );

      expect(callers.map((file) => file.slice(sourceRoot.length))).toEqual([
        "app/worker-production.composition.ts",
      ]);
    });
  });

  describe("when spanCommandShardCount is set above one", () => {
    /** @scenario "The pipeline shards the command while leaving the fold per-trace" */
    it("keeps the trace-summary fold keyed per trace, not per span", () => {
      const definition = build({ spanCommandShardCount: 8 });

      expect(definition.foldProjections.get("traceSummary")?.definition.key).toBe(undefined);
    });
  });

  describe("when spanCommandShardCount is left at its default of one", () => {
    /** @scenario "The pipeline preserves the trace-only key when sharding is off" */
    it("installs no getGroupKey on the recordSpan command", () => {
      const cmd = build().commands.find((c) => c.name === "recordSpan");

      expect(cmd).toBeDefined();
      expect(cmd!.options?.getGroupKey).toBeUndefined();
    });
  });
});
