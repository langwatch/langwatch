import type { Authorization } from "@langwatch/authorization";
import {
  type ElasticSearchEvent,
  type Span,
  type SpanTreeDeltaInput,
  type SpanTreeInput,
  type SpanTreeNode,
  type SpanTreePage,
  TraceCapabilityUnavailableError,
} from "@langwatch/trace-contract";

import type { TracesSpanReader } from "#app/trace.app";

import type { TraceService } from "../../../services/trace.service.ts";
import type { TraceBraidDetailService } from "../../read/services/trace-braid-detail.service.ts";

/** Every read the span store answers. */
export type TraceSpanRead = keyof TracesSpanReader;
type SpanReadParams<K extends TraceSpanRead> = Parameters<TracesSpanReader[K]>[0];
type SpanReadResult<K extends TraceSpanRead> = Awaited<ReturnType<TracesSpanReader[K]>>;
type Owners = readonly (string | null | undefined)[];
type OwnerRule<K extends TraceSpanRead> = (read: {
  params: SpanReadParams<K>;
  result: SpanReadResult<K>;
}) => Owners;

/** The tree's two reads under the caller's proof; the tree's other reads mint an own-only one. */
export type TraceSpanTreeReads = Pick<TraceService, "getSpanTreePage" | "getSpanTreeDelta">;

/** The owners rows name; a row names one only when braided in from another project (§5). */
function braidOwnersOf(shown: readonly unknown[]): string[] {
  return shown.flatMap((row) =>
    typeof row === "object" &&
    row !== null &&
    "ownerProjectId" in row &&
    typeof row.ownerProjectId === "string"
      ? [row.ownerProjectId]
      : [],
  );
}

const rows = ({ result }: { result: readonly unknown[] }): Owners => braidOwnersOf(result);
const values = ({ result }: { result: Readonly<Record<string, unknown>> }): Owners =>
  braidOwnersOf(Object.values(result));
/** A read by owner and id: the owner it named, once it found anything. */
const named = ({
  params,
  result,
}: {
  params: { ownerProjectId?: string | undefined };
  result: unknown;
}): Owners => {
  if (result === null || (Array.isArray(result) && result.length === 0)) return [];
  const shown: readonly unknown[] = Array.isArray(result) ? result : [result];
  return [params.ownerProjectId, ...braidOwnersOf(shown)];
};

/**
 * How each span read names the owners in what it returned. A read missing here fails the build,
 * and every rule reads the result, so a read that returns an owner's row is audited whatever it
 * was asked for (ADR-201 §8).
 */
const OWNERS_OF: { readonly [K in TraceSpanRead]: OwnerRule<K> } = {
  getSpansByTraceId: rows,
  getNormalizedSpansByTraceId: rows,
  findStoredSpansByTraceId: rows,
  findSpanById: named,
  getSpanEvents: named,
  getSpansPaginated: ({ result }) => braidOwnersOf(result.spans),
  getSpansSince: rows,
  getSpanSummaryByTraceId: rows,
  getLangwatchSignalsByTraceId: rows,
  getSpanResourcesByTraceId: rows,
  getTraceEventsByTraceId: rows,
  getTraceEventRollupsByTraceIds: values,
  getModelUsageStats: rows,
  getRecentSpansByModels: rows,
};

/** Every span read the trace module issues; the store is never handed out. */
export const TRACE_SPAN_READS = Object.keys(OWNERS_OF) as readonly TraceSpanRead[];

/**
 * The one door the trace module's span reads pass through (ADR-201 §8, v1.10): a read showing an
 * owner's span records one braided spans viewed entry first, or throws instead of returning. A
 * read showing only the reader's spans records nothing.
 */
export class TraceBraidAuditedSpanReadService {
  static create(deps: {
    spans: TracesSpanReader;
    tree: TraceSpanTreeReads | undefined;
    audit: Pick<TraceBraidDetailService, "recordView">;
  }): TraceBraidAuditedSpanReadService {
    return new TraceBraidAuditedSpanReadService(deps.spans, deps.tree, deps.audit);
  }

  readonly #spans: TracesSpanReader;
  readonly #tree: TraceSpanTreeReads | undefined;
  readonly #audit: Pick<TraceBraidDetailService, "recordView">;

  private constructor(
    spans: TracesSpanReader,
    tree: TraceSpanTreeReads | undefined,
    audit: Pick<TraceBraidDetailService, "recordView">,
  ) {
    this.#spans = spans;
    this.#tree = tree;
    this.#audit = audit;
  }

  /** One span store read, returned only once the owners it shows are audited. */
  async read<K extends TraceSpanRead>(
    method: K,
    params: SpanReadParams<K>,
  ): Promise<SpanReadResult<K>> {
    const reader = this.#spans[method] as (params: SpanReadParams<K>) => Promise<SpanReadResult<K>>;
    const result = await reader.call(this.#spans, params);
    const ownersOf = OWNERS_OF[method] as OwnerRule<K>;
    return this.#audited({
      authorization: (params as { authorization: Authorization }).authorization,
      ownerProjectIds: ownersOf({ params, result }),
      result,
    });
  }

  /** The span panel's span and its events, audited once for both. */
  async readSpanWithEvents(
    params: SpanReadParams<"findSpanById"> & SpanReadParams<"getSpanEvents">,
  ): Promise<{ span: Span | null; events: ElasticSearchEvent[] }> {
    const [span, events] = await Promise.all([
      this.#spans.findSpanById(params),
      this.#spans.getSpanEvents(params),
    ]);
    return this.#audited({
      authorization: params.authorization,
      ownerProjectIds: [...named({ params, result: span }), ...named({ params, result: events })],
      result: { span, events },
    });
  }

  async readSpanTreePage(
    input: SpanTreeInput & { authorization: Authorization },
  ): Promise<SpanTreePage> {
    const page = await this.#treeReads().getSpanTreePage(input);
    return this.#audited({
      authorization: input.authorization,
      ownerProjectIds: braidOwnersOf(page.nodes),
      result: page,
    });
  }

  async readSpanTreeDelta(
    input: SpanTreeDeltaInput & { authorization: Authorization },
  ): Promise<SpanTreeNode[]> {
    const nodes = await this.#treeReads().getSpanTreeDelta(input);
    return this.#audited({
      authorization: input.authorization,
      ownerProjectIds: braidOwnersOf(nodes),
      result: nodes,
    });
  }

  #treeReads(): TraceSpanTreeReads {
    if (!this.#tree) {
      throw new TraceCapabilityUnavailableError("this process", "the trace tree read");
    }
    return this.#tree;
  }

  async #audited<T>({
    authorization,
    ownerProjectIds,
    result,
  }: {
    authorization: Authorization;
    ownerProjectIds: Owners;
    result: T;
  }): Promise<T> {
    await this.#audit.recordView({ authorization, ownerProjectIds });
    return result;
  }
}
