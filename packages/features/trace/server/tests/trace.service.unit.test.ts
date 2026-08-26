import type { SpanTreeNode } from "@langwatch/trace-contract";
import { ModelProviderService } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  TraceRepository,
  type TraceSpanSummaryRecord,
  type TraceSpanPage,
} from "../src/ports/trace.port";
import { TraceService } from "../src/services/trace.service";

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

class FakeModelProviderService extends ModelProviderService {
  constructor(private readonly cost = 0) {
    super();
  }

  estimateCost(): number {
    return this.cost;
  }
  listForProject(): Promise<[]> {
    return Promise.resolve([]);
  }
  listForOrganization(): Promise<[]> {
    return Promise.resolve([]);
  }
  getForProject(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }
  tryGetProviderForProject(): Promise<never> {
    throw new Error("not used");
  }
  tryFindRowServingModel(): Promise<never> {
    throw new Error("not used");
  }
  getExecutionProviders(): Promise<never> {
    throw new Error("not used");
  }
  upsert(): Promise<never> {
    throw new Error("not used");
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
  validateApiKey(): Promise<never> {
    throw new Error("not used");
  }
  testConnection(): Promise<{ connected: boolean }> {
    return Promise.resolve({ connected: false });
  }
  getCodexStatus(): Promise<never> {
    throw new Error("not used");
  }
  refreshCodexForGateway(): Promise<never> {
    throw new Error("not used");
  }
  isManagedProvider(): boolean {
    return false;
  }
  getDefaultSnapshot(): Promise<never> {
    throw new Error("not used");
  }
  getInheritedValues(): Promise<never> {
    throw new Error("not used");
  }
  tryGetResolvedDefault(): Promise<null> {
    return Promise.resolve(null);
  }
  setDefault(): Promise<void> {
    return Promise.resolve();
  }
  saveDefaultConfig(): Promise<never> {
    throw new Error("not used");
  }
  tryGetDefaultConfig(): Promise<null> {
    return Promise.resolve(null);
  }
  deleteDefaultConfig(): Promise<void> {
    return Promise.resolve();
  }
  listCosts(): Promise<[]> {
    return Promise.resolve([]);
  }
  upsertCost(): Promise<never> {
    throw new Error("not used");
  }
  deleteCost(): Promise<void> {
    return Promise.resolve();
  }
  translate(): Promise<never> {
    throw new Error("not used");
  }
}

const service = (rows: SpanTreeNode[] = [node]) =>
  TraceService.create({
    repository: new FakeTraceRepository(rows.map(record)),
    modelProviders: new FakeModelProviderService(),
  });

describe("TraceService span-tree read", () => {
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
        modelProviders: new FakeModelProviderService(),
      }).getSpanTreePage({
        projectId: "project_1",
        traceId: "trace_1",
        limit: 1,
        canSeeCosts: true,
      }),
    ).rejects.toThrow(
      "span-summary page reported hasMore without any rows to key the cursor from",
    );
  });

  it("computes a missing cost through the full Model Provider service", async () => {
    const result = await TraceService.create({
      repository: new FakeTraceRepository([record({ ...node, cost: null })]),
      modelProviders: new FakeModelProviderService(0.12),
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
      modelProviders: new FakeModelProviderService(0.12),
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
