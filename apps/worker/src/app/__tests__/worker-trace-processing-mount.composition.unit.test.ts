import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AutomationTriggerMatchRecorderPort } from "@langwatch/automation-server";
import { CodingAgentTraceProcessingPort } from "@langwatch/coding-agent-server";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import { createWorkerTraceCapabilityServices } from "../worker-trace-capability-services.composition";
import { WorkerTraceProcessingPipeline } from "../worker-trace-processing-pipeline.composition";
import { createWorkerGovernanceRollups } from "../worker-governance-rollups.composition";
import { createWorkerTrackedEvents } from "../worker-tracked-event.composition";
import { createWorkerProcessDatabase } from "./support/worker-database.double";

/**
 * Spec: specs/trace-processing/worker-trace-pipeline-conversion.feature
 *
 * THE CONVERSION, asserted where it can actually fail. The definition test
 * beside this one proves the pipeline REGISTERS the right names; nothing in it
 * could tell a handler that reaches its collaborator from one that was handed
 * in and quietly does nothing — which is exactly what the fifteen parameters
 * used to be.
 *
 * So every assertion here drives a registered handler and observes the effect
 * at the far end: a durable trigger match written through Automation's own
 * recorder, an evaluation reported through Evaluation's, a synthetic span sent
 * back through `recordSpan`, a project's clustering claimed through Topic's.
 * A handler wired to the wrong proxy, or to none, fails here.
 */

const RECORDED: {
  reportEvaluation: unknown[];
  executeEvaluation: unknown[];
  computeRunMetrics: unknown[];
  computeExperimentRunMetrics: unknown[];
  bootstrapTopicClustering: string[];
  contributeSpanFacts: unknown[];
  triggerMatches: unknown[];
  recordSpan: unknown[];
  productEvents: unknown[];
  broadcasts: unknown[];
} = {
  reportEvaluation: [],
  executeEvaluation: [],
  computeRunMetrics: [],
  computeExperimentRunMetrics: [],
  bootstrapTopicClustering: [],
  contributeSpanFacts: [],
  triggerMatches: [],
  recordSpan: [],
  productEvents: [],
  broadcasts: [],
};

class RecordingTriggerMatches extends AutomationTriggerMatchRecorderPort {
  async send(input: unknown): Promise<void> {
    RECORDED.triggerMatches.push(input);
  }
}

class NoCodingAgentTraces extends CodingAgentTraceProcessingPort {
  normalizeSpan(): never {
    throw new Error("not reached in this test");
  }

  async tryGetNormalizedSpan(): Promise<null> {
    return null;
  }
}

function reset(): void {
  for (const value of Object.values(RECORDED)) value.length = 0;
}

/**
 * One project row, in the shape the project contract actually parses.
 *
 * EVERY FIELD IS LOAD-BEARING. `projectSchema` is `.strict()`, so a thin row
 * throws inside the repository — and `projectMetadataHandler` catches and logs
 * its own failures. A short double would leave this test green with the
 * subscriber never reaching Topic at all, which is precisely the failure it
 * exists to catch.
 */
const PROJECT_ROW = {
  id: "project-1",
  name: "Acme",
  slug: "acme",
  apiKey: "key",
  lwqlKey: "lwql",
  teamId: "team-1",
  language: "unknown",
  framework: "unknown",
  kind: "DEFAULT",
  firstMessage: false,
  integrated: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
};

const TEAM_ROW = {
  id: "team-1",
  name: "Core",
  slug: "core",
  organizationId: "org-1",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  departmentId: null,
};

/** One project with one trace automation and no privacy policy of its own. */
function prismaDouble() {
  return createWorkerProcessDatabase({
    project: {
      // The repository asks three different questions of one delegate: the bare
      // project, the project with its team, and the org admin behind it. Each
      // answer is shaped by the ARGUMENTS, because the bare read parses
      // strictly and would reject a row carrying a joined `team`.
      findUnique: async (args: { include?: object; select?: object }) => {
        if (args.select) {
          return {
            firstMessage: false,
            traceSharingEnabled: false,
            team: {
              organizationId: "org-1",
              organization: {
                id: "org-1",
                traceSharingEnabled: false,
                members: [{ userId: "user-1" }],
              },
            },
          };
        }
        if (args.include) return { ...PROJECT_ROW, team: TEAM_ROW };
        return PROJECT_ROW;
      },
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
      update: async () => ({ id: "project-1" }),
    },
    trigger: {
      findMany: async () => [
        {
          id: "trigger-1",
          projectId: "project-1",
          name: "every trace",
          action: "SEND_EMAIL",
          triggerKind: "AUTOMATION",
          actionParams: {},
          filters: {},
          filterQuery: null,
          alertType: null,
          message: null,
          customGraphId: null,
          notificationCadence: "immediate",
          traceDebounceMs: 0,
          lastRunAt: null,
          active: true,
        },
      ],
    },
    customLLMModelCost: { findMany: async () => [] },
    dataPrivacyPolicy: { findMany: async () => [] },
    monitor: { findMany: async () => [] },
    featureFlag: { findMany: async () => [], findUnique: async () => null },
    featureFlagExperimentSetting: { findUnique: async () => null },
  });
}

function composePipeline() {
  const database = prismaDouble();
  const trackedEvents = createWorkerTrackedEvents({ redis: null });
  trackedEvents.connect(async (data) => {
    RECORDED.recordSpan.push(data);
  });

  const pipeline = WorkerTraceProcessingPipeline.create({
    config: resolveWorkerConfig({ NODE_ENV: "test" }),
    services: createWorkerTraceCapabilityServices({ database: database as never }),
    featureFlags: {
      isEnabled: async () => false,
      isEnabledForProject: async () => false,
    } as never,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    stores: {
      spanAppendStore: { append: async () => undefined } as never,
      traceAnalyticsRollupAppendStore: { append: async () => undefined } as never,
      traceSummaryStore: { get: async () => null, save: async () => undefined } as never,
      traceAnalyticsStore: { get: async () => null, save: async () => undefined } as never,
    },
    commands: {
      executeEvaluation: async (data) => void RECORDED.executeEvaluation.push(data),
      reportEvaluation: async (data) => void RECORDED.reportEvaluation.push(data),
      computeRunMetrics: async (data) => void RECORDED.computeRunMetrics.push(data),
      computeExperimentRunMetrics: async (data) =>
        void RECORDED.computeExperimentRunMetrics.push(data),
      lookupExperimentId: async () => "experiment-1",
      bootstrapTopicClustering: async (projectId) =>
        void RECORDED.bootstrapTopicClustering.push(projectId),
      contributeSpanFacts: async (data) => void RECORDED.contributeSpanFacts.push(data),
      triggerMatches: new RecordingTriggerMatches(),
    },
    traceTriggers: {
      getActiveTraceTriggersForProject: async () => [
        {
          id: "trigger-1",
          projectId: "project-1",
          name: "every trace",
          action: "SEND_EMAIL" as const,
          triggerKind: "AUTOMATION" as const,
          actionParams: {},
          filters: {},
          filterQuery: null,
          alertType: null,
          message: null,
          customGraphId: null,
          notificationCadence: "immediate" as const,
          traceDebounceMs: 0,
          templates: null,
        },
      ],
    } as never,
    productAnalytics: {
      record: (event: unknown) => void RECORDED.productEvents.push(event),
    } as never,
    broadcast: {
      broadcastToTenant: async (tenantId: string, event: string, eventType: string) => {
        RECORDED.broadcasts.push({ tenantId, event, eventType });
      },
    } as never,
    codingAgentTraces: new NoCodingAgentTraces(),
    trackedEvents,
    ...createWorkerGovernanceRollups({ resolveClickHouseClient: async () => ({}) }),
  });

  return pipeline.build({ deferredOrigins: { schedule: async () => undefined } as never });
}

/**
 * One registered subscriber, driven exactly as the dispatcher drives it:
 * `shouldDispatch` first, then `handle` only if it passed. Skipping the
 * predicate would make every guard in the pipeline invisible to these tests —
 * including the origin guard that stops a replay re-firing alerts.
 */
function dispatch(
  definition: ReturnType<typeof composePipeline>,
  name: string,
  event: TraceProcessingEvent,
  subscriberContext: never,
): Promise<void> {
  const registered = definition.foldSubscribers.get(name) ?? definition.mapSubscribers.get(name);
  if (!registered) throw new Error(`the pipeline registered no subscriber named ${name}`);
  const subscriber = registered.definition;
  if (subscriber.shouldDispatch && !subscriber.shouldDispatch(event, subscriberContext)) {
    return Promise.resolve();
  }
  return subscriber.handle(event, subscriberContext);
}

const traceState = {
  traceId: "trace-1",
  occurredAt: Date.now(),
  totalCost: 1,
  totalPromptTokenCount: 10,
  totalCompletionTokenCount: 10,
  models: ["openai/gpt-5-mini"],
  attributes: { "langwatch.origin": "sdk" },
  computedInput: "hello",
  computedOutput: "world",
};

function spanEvent(overrides: Record<string, unknown> = {}): TraceProcessingEvent {
  return {
    id: "evt_1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    metadata: {},
    data: {},
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

/**
 * The dispatcher's own context shape.
 *
 * `foldState` and not `state`: the trace subscribers read the committed fold
 * through the `TriggerContext` wrapper the pipeline builds around this, and a
 * test that invented its own field name would exercise handlers against a
 * state they never see in production.
 */
function context(state: object = traceState) {
  return { tenantId: "project-1", aggregateId: "trace-1", foldState: state } as never;
}

describe("given the trace pipeline this process composes for itself", () => {
  describe("when the alert subscriber runs on an ingested trace", () => {
    /** @scenario "A trace alert is matched and recorded from the worker" */
    it("writes one durable match through Automation's own recorder", async () => {
      reset();
      const definition = composePipeline();

      await dispatch(definition, "triggerMatch", spanEvent(), context());

      expect(RECORDED.triggerMatches).toEqual([
        expect.objectContaining({
          tenantId: "project-1",
          traceId: "trace-1",
          triggerId: "trigger-1",
          action: "SEND_EMAIL",
          actionClass: "notify",
        }),
      ]);
    });

    /**
     * The origin guard is what keeps a topic-clustering re-emit over thousands
     * of historical traces from re-firing every alert a customer ever
     * configured. A composition that forgot it would look identical and fire on
     * every replayed event.
     *
     * @scenario "A replayed trace does not re-fire an alert" */
    it("records nothing for a trace with no ingestion origin", async () => {
      reset();
      const definition = composePipeline();

      await dispatch(
        definition,
        "triggerMatch",
        spanEvent(),
        context({ ...traceState, attributes: {} }),
      );

      expect(RECORDED.triggerMatches).toEqual([]);
    });
  });

  describe("when a span reports an evaluation the SDK ran", () => {
    /** @scenario "An SDK-reported evaluation reaches Evaluation's own command" */
    it("reports it through the evaluation pipeline's command proxy", async () => {
      reset();
      const definition = composePipeline();

      await dispatch(
        definition,
        "customEvaluationSync",
        spanEvent({
          data: {
            span: {
              traceId: "trace-1",
              spanId: "0123456789abcdef",
              name: "llm call",
              attributes: [],
              events: [
                {
                  name: "langwatch.evaluation.custom",
                  timeUnixNano: "0",
                  attributes: [
                    {
                      key: "json_encoded_event",
                      value: {
                        stringValue: JSON.stringify({
                          name: "Answer Relevancy",
                          passed: true,
                          score: 0.9,
                        }),
                      },
                    },
                  ],
                },
              ],
              links: [],
            },
          },
        }),
        context(),
      );

      expect(RECORDED.reportEvaluation).toHaveLength(1);
      expect(RECORDED.reportEvaluation[0]).toMatchObject({
        tenantId: "project-1",
        // Evaluation's own slug derivation, not a second one invented here.
        evaluatorId: "customeval_answer_relevancy",
      });
    });
  });

  describe("when live span feedback arrives", () => {
    /**
     * The tracked-event reactor is the one path that dispatches back into
     * Trace's own `recordSpan`, and the span it mints must be the same one the
     * REST endpoint mints — same deterministic id, same attribute encoding —
     * or a customer's rating is recorded twice under two spans.
     *
     * @scenario "Live span feedback is recorded as a tracked event" */
    it("mints the tracked-event span and sends it back through recordSpan", async () => {
      reset();
      const definition = composePipeline();

      await dispatch(
        definition,
        "trackedEventSync",
        spanEvent({
          data: {
            span: {
              traceId: "trace-1",
              spanId: "0123456789abcdef",
              name: "llm call",
              attributes: [],
              events: [
                {
                  name: "langwatch.event",
                  timeUnixNano: "0",
                  attributes: [
                    { key: "event.type", value: { stringValue: "thumbs_up_down" } },
                    { key: "event.metrics.vote", value: { doubleValue: 1 } },
                  ],
                },
              ],
              links: [],
            },
          },
        }),
        context(),
      );

      expect(RECORDED.recordSpan).toHaveLength(1);
      const recorded = RECORDED.recordSpan[0] as {
        tenantId: string;
        span: { name: string; attributes: { key: string; value: Record<string, unknown> }[] };
      };
      expect(recorded.tenantId).toBe("project-1");
      expect(recorded.span.attributes.map((attribute) => attribute.key)).toEqual(
        expect.arrayContaining(["event.type", "event.id", "event.metrics.vote"]),
      );
    });
  });

  describe("when a project's first trace lands", () => {
    /** @scenario "A project's first trace claims its topic clustering" */
    it("claims clustering through Topic's own rate-limited bootstrap", async () => {
      reset();
      const definition = composePipeline();

      await dispatch(definition, "projectMetadata", spanEvent(), context());

      expect(RECORDED.bootstrapTopicClustering).toEqual(["project-1"]);
      // The milestone goes to the ORG ADMIN, resolved through the same project
      // service — a product event with no user id would join no person.
      expect(RECORDED.productEvents).toMatchObject([
        { userId: "user-1", event: "first_trace_integrated", projectId: "project-1" },
      ]);
    });
  });

  describe("when a simulation or experiment trace settles", () => {
    /** @scenario "Scenario and Experiment metrics are published from the worker" */
    it("publishes each through the owning feature's command proxy", async () => {
      reset();
      const definition = composePipeline();

      await dispatch(
        definition,
        "simulationMetricsSync",
        spanEvent(),
        context({
          ...traceState,
          attributes: { "langwatch.origin": "sdk", "scenario.run_id": "run-1" },
        }),
      );
      await dispatch(
        definition,
        "experimentMetricsSync",
        spanEvent(),
        context({
          ...traceState,
          attributes: { "langwatch.origin": "sdk", "evaluation.run_id": "run-2" },
        }),
      );

      expect(RECORDED.computeRunMetrics).toMatchObject([
        { tenantId: "project-1", scenarioRunId: "run-1", traceId: "trace-1" },
      ]);
      // Experiment resolves its own run id through the lookup this process
      // composed, and publishes the fold's cost rather than recomputing one.
      expect(RECORDED.computeExperimentRunMetrics).toMatchObject([
        { tenantId: "project-1", experimentId: "experiment-1", runId: "run-2", totalCost: 1 },
      ]);
    });
  });

  describe("when the pipeline broadcasts", () => {
    /** @scenario "Both broadcast subscribers publish through one bridge" */
    it("publishes through the tenant bridge this process composed", async () => {
      reset();
      const definition = composePipeline();

      await dispatch(definition, "traceUpdateBroadcast", spanEvent(), context());
      await dispatch(definition, "spanStorageBroadcast", spanEvent(), context());

      expect(RECORDED.broadcasts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when the frozen registry is read back", () => {
    /**
     * Twenty-seven registrations plus the installer's two jobs is the whole
     * registry entry. It is read from `job-registry.json` rather than listed
     * here, because that file is what the queue routes on.
     *
     * @scenario "The worker mounts every trace routing key" */
    it("registers every key the frozen registry lists but the installer's two jobs", () => {
      const definition = composePipeline();
      const registryPath = fileURLToPath(
        new URL("../../features/job-registry.json", import.meta.url),
      );
      const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
        pipelines: Array<{ name: string; jobs: string[] }>;
      };
      const frozen = registry.pipelines.find((entry) => entry.name === "trace_processing")!.jobs;

      const registered = new Set<string>();
      for (const name of definition.foldProjections.keys()) registered.add(`projection:${name}`);
      for (const name of definition.mapProjections.keys()) registered.add(`handler:${name}`);
      for (const command of definition.commands) registered.add(`command:${command.name}`);
      for (const name of definition.foldSubscribers.keys()) registered.add(`reactor:${name}`);
      for (const name of definition.mapSubscribers.keys()) registered.add(`reactor:${name}`);
      for (const name of definition.eventSubscribers.keys()) registered.add(`subscriber:${name}`);

      expect(frozen.filter((key) => !registered.has(key))).toEqual([
        "job:datasetNormalize",
        "job:deferredOriginResolution",
      ]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
    });

    /**
     * `command:recordSpan` is composed rather than handed in, so the definition
     * must carry a real handler. A stand-in would register the same key and
     * record nothing.
     *
     * @scenario "The worker mounts every trace routing key" */
    it("carries a real record-span handler behind the command it registers", () => {
      const definition = composePipeline();
      const recordSpan = definition.commands.find((command) => command.name === "recordSpan");

      expect(recordSpan?.handlerInstance).toBeDefined();
      expect(vi.isMockFunction(recordSpan?.handlerInstance?.handle)).toBe(false);
    });
  });
});
