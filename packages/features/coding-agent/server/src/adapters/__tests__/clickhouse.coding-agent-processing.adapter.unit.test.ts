import { describe, expect, it, vi } from "vitest";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { ClickHouseCodingAgentProcessingAdapter } from "../clickhouse.coding-agent-processing.adapter";
import { ModelCatalogCostEstimatorAdapter } from "../model-catalog.cost-estimator.adapter";
import type { CodingAgentProcessingPipeline } from "../eventing.coding-agent-processing.adapter";
import { type CodingAgentSessionState } from "../../projections/coding-agent-session.projection";
import { CodingAgentSessionStateProjection } from "../../projections/coding-agent-session-state.projection";
import { CodingAgentProjectActivityPort } from "../../ports/coding-agent-project-activity.port";
import { CodingAgentPullRequestMappingPort } from "../../ports/coding-agent-pull-request-mapping.port";

/**
 * The replication-lag floor `RedisCachedFoldStore` clamps every TTL up to.
 *
 * Restated here rather than imported because the point of the case below is
 * that a process which configures nothing still gets a bounded, correct TTL —
 * an import would assert the constant against itself.
 */
const FOLD_CACHE_FLOOR_SECONDS = 300;

class TestTraceCanonicalisation extends TraceCanonicalisationService {
  canonicalizeSpanAttributes() {
    return { attributes: {}, events: [], appliedRules: [] };
  }

  canonicalizeLogRecord() {
    return { attributes: {}, appliedRules: [] };
  }

  tryExtractMessageText(): null {
    return null;
  }

  deriveClaudeRequestContent() {
    return { messages: null, toolResults: [] };
  }

  deriveClaudeResponseContent() {
    return { assistantText: null, assistantOutput: null, sessionTitle: null };
  }

  classifyClaudeCall() {
    return { conversational: false, cacheWritesLongLived: false };
  }
}

class RecordingProjectActivity extends CodingAgentProjectActivityPort {
  readonly touched: { projectId: string; at: Date }[] = [];

  async touchCodingAgentSessionSeen(input: { projectId: string; at: Date }): Promise<void> {
    this.touched.push(input);
  }
}

class MappingEverything extends CodingAgentPullRequestMappingPort {
  canMapRepositoryHost(): boolean {
    return true;
  }

  async requestBranchMapping(): Promise<void> {}
}

function foldedSession(): CodingAgentSessionState {
  return {
    ...CodingAgentSessionStateProjection.create().createInitCodingAgentSession(),
    sessionId: "session_1",
    agent: "claude_code",
    // One model call is what makes the fold persistable; a state with no
    // signal at all is dropped before it reaches ClickHouse by design.
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 5,
    sessionKeySource: "provider",
    traceIds: ["trace_1"],
    startedAtMs: 1_800_000_000_000,
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_500,
    LastEventOccurredAt: 1_800_000_000_400,
  } as CodingAgentSessionState;
}

function compose(
  options: {
    foldCacheTtlSeconds?: number;
    pullRequestMapping?: CodingAgentPullRequestMappingPort | undefined;
  } = {},
) {
  const insert = vi.fn(
    async (_request: { table: string; values: readonly unknown[] }) => undefined,
  );
  const resolveClient = vi.fn(async () => ({
    insert,
    query: async () => ({ json: async () => [] }),
  }));
  const set = vi.fn(async (..._args: unknown[]) => "OK");
  const redis = { get: vi.fn(async () => null), set };
  const projectActivity = new RecordingProjectActivity();

  const pipeline: CodingAgentProcessingPipeline = ClickHouseCodingAgentProcessingAdapter.create({
    resolveClient: resolveClient as never,
    defaultRetentionDays: 49,
    redis: redis as never,
    traceCanonicalisation: new TestTraceCanonicalisation(),
    projectActivity,
    pullRequestMapping:
      "pullRequestMapping" in options ? options.pullRequestMapping : new MappingEverything(),
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { foldCacheTtlSeconds: options.foldCacheTtlSeconds }),
  }).buildProcessing();

  return { pipeline, insert, resolveClient, redis, set, projectActivity };
}

function sessionFoldStore(
  pipeline: CodingAgentProcessingPipeline,
): FoldProjectionStore<CodingAgentSessionState> {
  const fold = pipeline.foldProjections.get("codingAgentSession");
  expect(fold, "the pipeline registered no codingAgentSession fold").toBeDefined();
  return (fold!.definition as unknown as { store: FoldProjectionStore<CodingAgentSessionState> })
    .store;
}

async function storeThrough(pipeline: CodingAgentProcessingPipeline): Promise<void> {
  await sessionFoldStore(pipeline).store(foldedSession(), {
    aggregateId: "session_1",
    tenantId: createTenantId("project_alpha"),
  });
}

describe("ClickHouseCodingAgentProcessingAdapter", () => {
  describe("given a process holding a tenant-keyed client, its own Redis and a project seam", () => {
    /** @scenario "Durable processing composes from one client, one Redis and one database" */
    it("builds the session pipeline from those alone", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe("coding_agent_processing");
      expect(pipeline.commands.map((command) => command.name)).toEqual([
        "contributeSpanFacts",
        "contributeLogFacts",
        "contributeMetricFacts",
      ]);
    });

    /** @scenario "Durable processing composes from one client, one Redis and one database" */
    it("registers the fold, its three appends and the cost-drift subscriber", () => {
      const { pipeline } = compose();

      expect([...pipeline.foldProjections.keys()]).toEqual(["codingAgentSession"]);
      expect([...pipeline.mapProjections.keys()]).toEqual([
        "codingAgentTraceSessions",
        "sessionMetricSeries",
        "codingAgentSessionEvents",
      ]);
      expect([...pipeline.eventSubscribers.keys()]).toEqual(["codingAgentCostDrift"]);
    });

    /** @scenario "Durable processing composes from one client, one Redis and one database" */
    it("registers the pull-request mapping subscriber, because the queue routes its key", () => {
      const { pipeline } = compose();

      // `reactor:pullRequestMapping` is one of the routing keys the producer
      // stages jobs against. A consumer composed without a GitHub demand path
      // registers one key fewer, and the queue rejects an unroutable job for
      // redelivery rather than dropping it — so those jobs stall forever
      // while every health signal stays green.
      expect([...pipeline.foldSubscribers.keys()]).toEqual(["pullRequestMapping"]);
    });

    /** @scenario "Durable processing composes from one client, one Redis and one database" */
    it("mounts no mapping subscriber where there is no GitHub connection to ask", () => {
      const { pipeline } = compose({ pullRequestMapping: undefined });

      expect([...pipeline.foldSubscribers.keys()]).toEqual([]);
    });
  });

  describe("when a folded session is stored", () => {
    /** @scenario "Session rows are written through the client this graph resolved" */
    it("resolves the client for the tenant the session names", async () => {
      const { pipeline, resolveClient, insert } = compose();

      await storeThrough(pipeline);

      // The client this composition resolved, for the tenant the fold names.
      // A pipeline handed any other client registers the identical routing
      // keys and writes its rows somewhere nothing reads.
      expect(resolveClient).toHaveBeenCalledWith("project_alpha");
      expect(insert.mock.calls.map(([request]) => request.table)).toEqual([
        "coding_agent_sessions",
      ]);
    });

    /** @scenario "Session rows are written through the client this graph resolved" */
    it("stamps the row with the retention the substrate already carries", async () => {
      const { pipeline, insert } = compose();

      await storeThrough(pipeline);

      // 49 is the `defaultRetentionDays` this adapter was composed with, not a
      // number configured a second time. Two graphs stamping different
      // retentions on one table expire each other's rows.
      expect(insert.mock.calls[0]![0].values[0]).toMatchObject({
        TenantId: "project_alpha",
        SessionId: "session_1",
        _retention_days: 49,
      });
    });

    /** @scenario "Both graphs cache the session fold under one keyspace" */
    it("writes the cache entry under the keyspace the App also reads", async () => {
      const { pipeline, set } = compose();

      await storeThrough(pipeline);

      // Frozen twin: the pipeline definition names `coding_agent_sessions` on
      // both graphs, and the two share one Redis. A prefix that drifted would
      // leave each side reading a cache the other never writes.
      expect(set.mock.calls[0]![0]).toBe("fold:coding_agent_sessions:project_alpha:session_1");
    });

    /** @scenario "Storing a session stamps its project's activity" */
    it("records the project as having seen coding-agent activity", async () => {
      const { pipeline, projectActivity } = compose();

      await storeThrough(pipeline);

      // The stamp is why the pipeline used to demand the whole ProjectService.
      // It is fire-and-forget behind the commit, so the assertion is that the
      // one-method seam this graph composed is the thing that receives it.
      expect(projectActivity.touched.map((entry) => entry.projectId)).toEqual(["project_alpha"]);
    });
  });

  describe("given a fold cache TTL named by the process", () => {
    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("writes cache entries with that TTL", async () => {
      const { pipeline, set } = compose({ foldCacheTtlSeconds: 900 });

      await storeThrough(pipeline);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", 900]);
    });

    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("falls back to the replication-lag floor when the process names none", async () => {
      const { pipeline, set } = compose();

      await storeThrough(pipeline);

      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", FOLD_CACHE_FLOOR_SECONDS]);
    });
  });

  describe("when a model call is priced", () => {
    /** @scenario "A model call is priced from the platform catalog alone" */
    it("prices a catalogued model from the catalog's own rates", () => {
      const estimator = ModelCatalogCostEstimatorAdapter.create();

      const cost = estimator.estimateCost({
        attrs: {},
        model: "openai/gpt-5-mini",
        promptTokens: 1_000_000,
        completionTokens: 0,
      });

      // A real rate rather than a pinned number: the catalog's prices change
      // with the vendors', and what this holds is that the estimator reads
      // them at all. A composition that reached no catalog answers zero.
      expect(cost).toBeGreaterThan(0);
    });

    /** @scenario "A model call is priced from the platform catalog alone" */
    it("prefers custom per-token rates carried on the call's own attributes", () => {
      const estimator = ModelCatalogCostEstimatorAdapter.create();

      const cost = estimator.estimateCost({
        attrs: {
          "langwatch.model.inputCostPerToken": 0.5,
          "langwatch.model.outputCostPerToken": 0,
        },
        model: "openai/gpt-5-mini",
        promptTokens: 4,
        completionTokens: 0,
      });

      // This is why the App's provider stack was never being consulted: a
      // tenant's overridden price travels on the span, so both graphs price
      // an overridden call identically without either reading a database.
      expect(cost).toBe(2);
    });
  });
});
