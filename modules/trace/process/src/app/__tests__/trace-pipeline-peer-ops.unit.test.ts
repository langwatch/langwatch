import { createApiFixture } from "@langwatch/api-fixture";
import type { AssignTopicCommandData, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { EventingTraceTopicAssignment } from "../../eventing/trace-topic-assignment.commands.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { ModelCatalogTraceModelCostAdapter } from "../../services/model-catalog.trace-model-cost.service.ts";
import { ScenarioRoleMetricsDerivationService } from "../../services/scenario-role-metrics-derivation.service.ts";
import { SpanCostService } from "../../services/span-cost.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceTopicClusteringReadService } from "../../services/trace-topic-clustering-read.service.ts";
import { TraceApp, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

const canonicalisation = TraceCanonicalisationService.create();

function createTraceApp(overrides: Partial<TraceAppDependencies> = {}): TraceApp {
  return TraceApp.create(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        canonicalisation,
        read: createApiFixture<TraceLegacyRead>(),
      }),
      ...overrides,
    }),
  );
}

const assignment: AssignTopicCommandData = {
  tenantId: "project-1",
  traceId: "trace-1",
  topicId: "topic-1",
  topicName: "Billing",
  subtopicId: null,
  subtopicName: null,
  isIncremental: true,
  occurredAt: 1_000,
};

const summary: TraceSummaryData = {
  traceId: "trace-1",
  spanCount: 1,
  totalDurationMs: 10,
  computedIOSchemaVersion: "1",
  computedInput: null,
  computedOutput: null,
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  models: [],
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  outputFromRootSpan: false,
  outputSpanEndTimeMs: 0,
  blockedByGuardrail: false,
  rootSpanType: null,
  containsAi: false,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  topicId: "t1",
  subTopicId: null,
  annotationIds: [],
  attributes: {},
  traceName: "",
  occurredAt: 0,
  createdAt: 0,
  updatedAt: 0,
  LastEventOccurredAt: 0,
};

describe("TraceApi operations the worker pipelines call", () => {
  describe("classifyClaudeCall()", () => {
    it("answers what trace's canonicalisation decides for the call", () => {
      const input = { querySource: "repl_main_thread", llmRequestContext: null };

      expect(createTraceApp().classifyClaudeCall(input)).toEqual(
        canonicalisation.classifyClaudeCall(input),
      );
    });
  });

  describe("deriveClaudeResponseContent()", () => {
    it("answers what trace's canonicalisation derives from the response body", () => {
      const input = { body: { content: [{ type: "text", text: "Hello there" }] } };

      expect(createTraceApp().deriveClaudeResponseContent(input)).toEqual(
        canonicalisation.deriveClaudeResponseContent(input),
      );
    });
  });

  describe("assignTopic()", () => {
    it("sends the assignment on trace_processing's assignTopic command", async () => {
      const sent: AssignTopicCommandData[] = [];
      const app = createTraceApp({
        topicAssignment: EventingTraceTopicAssignment.create({
          sendAssignTopic: async (input) => {
            sent.push(input);
          },
        }),
      });

      await app.assignTopic(assignment);

      expect(sent).toEqual([assignment]);
    });

    it("refuses where this process composed no assignTopic sender", async () => {
      await expect(
        createTraceApp({ topicAssignment: undefined }).assignTopic(assignment),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  describe("deriveScenarioRoleMetrics()", () => {
    it("derives per-role metrics from the trace's stored spans", async () => {
      const app = createTraceApp({
        scenarioRoleMetrics: ScenarioRoleMetricsDerivationService.create({
          spans: MemoryTraceRepositories.create().derivationSpans,
          spanCosts: SpanCostService.create({
            modelCosts: ModelCatalogTraceModelCostAdapter.create(),
          }),
        }),
      });

      await expect(
        app.deriveScenarioRoleMetrics({ tenantId: "project-1", traceId: "trace-1" }),
      ).resolves.toEqual({ scenarioRoleCosts: {}, scenarioRoleLatencies: {} });
    });
  });

  describe("matchesFilterQuery()", () => {
    const match = (query: string) =>
      createTraceApp().matchesFilterQuery({
        query,
        foldState: summary,
        evaluations: null,
        events: null,
      });

    it("matches a folded trace the saved query selects", () => {
      expect(match("topic:t1")).toBe(true);
    });

    it("does not match a folded trace the saved query excludes", () => {
      expect(match("topic:t2")).toBe(false);
    });

    it("fails closed on a query it cannot parse", () => {
      expect(match("topic:(")).toBe(false);
    });
  });

  describe("matchesTraceFilters()", () => {
    const match = (filters: Record<string, unknown>) =>
      createTraceApp().matchesTraceFilters({ filters, foldState: summary, events: null });

    it("matches a folded trace the trigger's trace filters select", () => {
      expect(match({ "topics.topics": ["t1"] })).toBe(true);
    });

    it("does not match a folded trace the trigger's trace filters exclude", () => {
      expect(match({ "topics.topics": ["t2"] })).toBe(false);
    });

    it("fails closed on an evaluation filter it cannot answer from the trace", () => {
      expect(match({ "evaluations.passed": { "evaluator-1": ["true"] } })).toBe(false);
    });

    it("matches an event metric range from the derived events", () => {
      expect(
        createTraceApp().matchesTraceFilters({
          filters: { "events.metrics.value": { thumbs: { vote: ["1", "1"] } } },
          foldState: summary,
          events: [
            {
              spanId: "span-1",
              timestamp: 0,
              name: "thumbs",
              attributes: { "event.metrics.vote": "1" },
            },
          ],
        }),
      ).toBe(true);
    });
  });

  describe("readTopicClusteringCounts()", () => {
    it("reads the counts from trace's own summaries", async () => {
      const app = createTraceApp({
        topicClustering: TraceTopicClusteringReadService.create({
          repository: MemoryTraceRepositories.create().clusteringSample,
        }),
      });

      await expect(app.readTopicClusteringCounts({ projectId: "project-1" })).resolves.toEqual({
        totalTracesCount: 0,
        recentTracesCount: 0,
        assignedTracesCount: 0,
      });
    });

    it("refuses where this process composed no clustering read", async () => {
      await expect(
        createTraceApp({ topicClustering: undefined }).readTopicClusteringCounts({
          projectId: "project-1",
        }),
      ).rejects.toBeInstanceOf(Error);
    });
  });
});
