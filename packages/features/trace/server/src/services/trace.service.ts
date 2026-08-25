import {
  spanTreeDeltaInputSchema,
  spanTreeInputSchema,
  spanTreePageSchema,
  TraceService as TraceServiceContract,
  type SpanTreeNode,
  type SpanTreeDeltaInput,
  type SpanTreePage,
  type SpanTreeInput,
} from "@langwatch/trace-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";

import {
  TraceRepository,
  type TraceSpanSummaryRecord,
} from "../ports/trace.port";

type TraceComposition = {
  repository: TraceRepository;
  modelProviders: ModelProviderService;
};

const gateCosts = (
  nodes: SpanTreeNode[],
  canSeeCosts: boolean,
): SpanTreeNode[] =>
  canSeeCosts ? nodes : nodes.map((node) => ({ ...node, cost: null }));

export class TraceService extends TraceServiceContract {
  private constructor(private readonly composition: TraceComposition) {
    super();
  }

  static create(composition: TraceComposition): TraceService {
    return new TraceService(composition);
  }

  async getSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage> {
    const parsed = spanTreeInputSchema.parse(input);
    const page = await this.composition.repository.findSummaryPage({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
      limit: parsed.limit,
      cursor: parsed.cursor,
      occurredAtMs: parsed.occurredAtMs,
    });
    const nodes = gateCosts(
      page.rows.map((row) => this.price(row)),
      parsed.canSeeCosts,
    );
    const last = page.rows.at(-1);

    if (page.hasMore && !last) {
      throw new Error(
        "span-summary page reported hasMore without any rows to key the cursor from",
      );
    }

    return spanTreePageSchema.parse({
      nodes,
      nextCursor:
        page.hasMore && last
          ? { startTimeMs: last.startTimeMs, spanId: last.spanId }
          : null,
    });
  }

  async getSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]> {
    const parsed = spanTreeDeltaInputSchema.parse(input);
    const rows = await this.composition.repository.findSummarySince({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
      sinceUpdatedAtMs: parsed.sinceUpdatedAtMs,
    });
    return gateCosts(rows.map((row) => this.price(row)), parsed.canSeeCosts);
  }

  private price({
    costInput,
    cost,
    ...node
  }: TraceSpanSummaryRecord): SpanTreeNode {
    if (cost !== null) return { ...node, cost };
    const computed = this.composition.modelProviders.estimateCost(costInput);
    return { ...node, cost: computed > 0 ? computed : null };
  }
}
