import type { SpanTreeNode, TraceFullRecord } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  TraceQueryFieldValuesPort,
  type TraceQueryFieldValuesInput,
  type TraceQueryFieldValuesResult,
} from "../src/ports/query-field-values.port";
import {
  TraceRepository,
  type TraceSpanSummaryRecord,
  type TraceSpanPage,
} from "../src/ports/trace.port";
import { TraceSummaryReaderPort } from "../src/ports/trace-summary-reader.port";
import { TraceService } from "../src/services/trace.service";
import { TraceFullRecordPort } from "../src/ports/trace-full-record.port";
import { TestModelProviderService } from "./support/model-provider.service.fake";
import { TestTraceQueryClassification } from "./support/query-classification.fake";
import { traceReadPorts } from "./support/trace-read-ports.fake";

const node: SpanTreeNode = {
  spanId: "span_1",
  parentSpanId: null,
  name: "llm",
  type: "llm",
  startTimeMs: 10,
  endTimeMs: 30,
  durationMs: 20,
  status: "ok",
  model: "model",
  toolName: null,
  cost: 0.2,
  inputTokens: 2,
  outputTokens: 2,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  updatedAtMs: 30,
};

const record = (value: SpanTreeNode): TraceSpanSummaryRecord => ({
  ...value,
  cost: value.cost ?? null,
  costInput: {
    attrs: {},
    promptTokens: value.inputTokens ?? null,
    completionTokens: value.outputTokens ?? null,
  },
});

class FakeTraceRepository extends TraceRepository {
  findEvaluationSpans(): Promise<[]> {
    return Promise.resolve([]);
  }

  findEvaluationEvents(): Promise<[]> {
    return Promise.resolve([]);
  }

  async tryFindIngestLag(): Promise<null> {
    return null;
  }

  constructor(private readonly rows: TraceSpanSummaryRecord[] = [record(node)]) {
    super();
  }

  async findSummaryPage(input: {
    tenantId: string;
    traceId: string;
    limit: number;
  }): Promise<TraceSpanPage> {
    expect(input.tenantId).toBe("project_1");
    expect(input.traceId).toBe("trace_1");
    return { rows: this.rows, hasMore: this.rows.length > 0 };
  }

  async findSummarySince(): Promise<TraceSpanSummaryRecord[]> {
    return this.rows;
  }
}

class EmptyQueryFieldValues extends TraceQueryFieldValuesPort {
  async list(): Promise<TraceQueryFieldValuesResult> {
    return { values: [] };
  }
}

class CapturingSummaryReader extends TraceSummaryReaderPort {
  readonly calls: Array<{ tenantId: string; traceId: string }> = [];

  async tryGetSummary(input: { tenantId: string; traceId: string }): Promise<null> {
    this.calls.push(input);
    return null;
  }
}

class FullRecords extends TraceFullRecordPort {
  readonly calls: string[] = [];

  async get(): Promise<TraceFullRecord> {
    this.calls.push("trace");
    return {
      trace_id: "trace_1",
      project_id: "project_1",
      metadata: {},
      timestamps: { started_at: 1, inserted_at: 1 },
      spans: [],
    };
  }

  async getThread(): Promise<TraceFullRecord[]> {
    this.calls.push("thread");
    return [];
  }
}

const service = (
  rows: SpanTreeNode[] = [node],
  queryFieldValues: TraceQueryFieldValuesPort = new EmptyQueryFieldValues(),
) =>
  TraceService.create({
    repository: new FakeTraceRepository(rows.map(record)),
    modelProviders: new TestModelProviderService(),
    queryFieldValues,
    queryClassification: new TestTraceQueryClassification(),
    summaryReader: new CapturingSummaryReader(),
    ...traceReadPorts(),
  });

class CharacterizedQueryFieldValues extends TraceQueryFieldValuesPort {
  readonly calls: TraceQueryFieldValuesInput[] = [];

  async list(input: TraceQueryFieldValuesInput): Promise<TraceQueryFieldValuesResult> {
    this.calls.push(input);

    if (input.facetKey === "model") {
      throw new Error("model facet unavailable");
    }

    if (input.facetKey === "status") {
      return {
        values: [{ value: "warning" }, { value: "custom" }],
      };
    }

    return { values: [] };
  }
}

describe("TraceService span-tree read", () => {
  it("delegates full internal records only through the named Trace port", async () => {
    const fullRecords = new FullRecords();
    const traceService = TraceService.create({
      repository: new FakeTraceRepository(),
      modelProviders: new TestModelProviderService(),
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      ...traceReadPorts(),
      summaryReader: new CapturingSummaryReader(),
      fullRecords,
    });

    await expect(
      traceService.getFullRecord({ tenantId: "project_1", traceId: "trace_1" }),
    ).resolves.toMatchObject({ trace_id: "trace_1" });
    await expect(
      traceService.getFullThread({ tenantId: "project_1", threadId: "thread_1" }),
    ).resolves.toEqual([]);
    expect(fullRecords.calls).toEqual(["trace", "thread"]);
  });

  it("looks up a summary through the Trace-owned projection reader", async () => {
    const summaryReader = new CapturingSummaryReader();
    const traceService = TraceService.create({
      repository: new FakeTraceRepository(),
      modelProviders: new TestModelProviderService(),
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      summaryReader,
      ...traceReadPorts(),
    });

    await expect(
      traceService.tryGetSummary({ projectId: "project_1", traceId: "trace_1" }),
    ).resolves.toBeNull();
    expect(summaryReader.calls).toEqual([{ tenantId: "project_1", traceId: "trace_1" }]);
  });

  it("returns the complete characterized page and cursor", async () => {
    await expect(
      service().getSpanTreePage({
        projectId: "project_1",
        traceId: "trace_1",
        limit: 1,
        canSeeCosts: true,
      }),
    ).resolves.toEqual({
      nodes: [node],
      nextCursor: { startTimeMs: 10, spanId: "span_1" },
    });
  });

  it("redacts cost without changing the rest of the node", async () => {
    const result = await service().getSpanTreePage({
      projectId: "project_1",
      traceId: "trace_1",
      limit: 1,
      canSeeCosts: false,
    });
    expect(result.nodes[0]).toEqual({ ...node, cost: null });
  });

  it("preserves the live empty-page response when no spans are found", async () => {
    await expect(
      service([]).getSpanTreePage({
        projectId: "project_1",
        traceId: "trace_1",
        limit: 1,
        canSeeCosts: true,
      }),
    ).resolves.toEqual({ nodes: [], nextCursor: null });
  });

  it("fails loudly if a repository claims another page without a cursor row", async () => {
    class InvalidTraceRepository extends TraceRepository {
      findEvaluationSpans(): Promise<[]> {
        return Promise.resolve([]);
      }

      findEvaluationEvents(): Promise<[]> {
        return Promise.resolve([]);
      }

      async tryFindIngestLag(): Promise<null> {
        return null;
      }

      async findSummaryPage(): Promise<TraceSpanPage> {
        return { rows: [], hasMore: true };
      }

      async findSummarySince(): Promise<TraceSpanSummaryRecord[]> {
        return [];
      }
    }

    await expect(
      TraceService.create({
        repository: new InvalidTraceRepository(),
        modelProviders: new TestModelProviderService(),
        queryFieldValues: new EmptyQueryFieldValues(),
        queryClassification: new TestTraceQueryClassification(),
        summaryReader: new CapturingSummaryReader(),
        ...traceReadPorts(),
      }).getSpanTreePage({
        projectId: "project_1",
        traceId: "trace_1",
        limit: 1,
        canSeeCosts: true,
      }),
    ).rejects.toThrow("span-summary page reported hasMore without any rows to key the cursor from");
  });

  it("computes a missing cost through the full Model Provider service", async () => {
    const result = await TraceService.create({
      repository: new FakeTraceRepository([record({ ...node, cost: null })]),
      modelProviders: new TestModelProviderService(0.12),
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      summaryReader: new CapturingSummaryReader(),
      ...traceReadPorts(),
    }).getSpanTreePage({
      projectId: "project_1",
      traceId: "trace_1",
      limit: 1,
      canSeeCosts: true,
    });

    expect(result.nodes[0]).toEqual({ ...node, cost: 0.12 });
  });

  it("preserves every live delta node field while pricing and gating costs", async () => {
    const priced = await TraceService.create({
      repository: new FakeTraceRepository([record({ ...node, cost: null })]),
      modelProviders: new TestModelProviderService(0.12),
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      summaryReader: new CapturingSummaryReader(),
      ...traceReadPorts(),
    }).getSpanTreeDelta({
      projectId: "project_1",
      traceId: "trace_1",
      sinceUpdatedAtMs: 29,
      canSeeCosts: true,
    });

    expect(priced).toEqual([{ ...node, cost: 0.12 }]);

    const redacted = await service().getSpanTreeDelta({
      projectId: "project_1",
      traceId: "trace_1",
      sinceUpdatedAtMs: 29,
      canSeeCosts: false,
    });
    expect(redacted).toEqual([{ ...node, cost: null }]);
  });
});

describe("TraceService query field catalogue", () => {
  it("merges live values before static values and degrades one failed facet", async () => {
    const fieldValues = new CharacterizedQueryFieldValues();
    const catalogue = await service([], fieldValues).buildQueryFieldCatalogue({
      projectId: "project_1",
      timeRange: { from: 100, to: 200 },
    });

    expect(catalogue).toContain("- status (categorical): Status — e.g. warning, custom, error, ok");
    expect(catalogue).toContain("- model (categorical): Model");
    expect(catalogue).not.toContain("- model (categorical): Model — e.g.");
    expect(fieldValues.calls.length).toBeGreaterThan(1);
    expect(fieldValues.calls).toEqual(
      expect.arrayContaining([
        {
          projectId: "project_1",
          timeRange: { from: 100, to: 200 },
          facetKey: "status",
          limit: 20,
          offset: 0,
        },
      ]),
    );
  });
});
