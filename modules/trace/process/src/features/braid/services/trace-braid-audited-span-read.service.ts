import { type Authorization, ownProjectIdReadBy } from "@langwatch/authorization";
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
import type { TraceBraidReadsRepository } from "../repositories/trace-braid-reads.repository.ts";

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

/** Every read the braid reads repository answers. */
export type TraceBraidRead = {
  [K in keyof TraceBraidReadsRepository]: TraceBraidReadsRepository[K] extends (
    input: never,
  ) => Promise<unknown>
    ? K
    : never;
}[keyof TraceBraidReadsRepository];
type BraidReadParams<K extends TraceBraidRead> = Parameters<TraceBraidReadsRepository[K]>[0];
type BraidReadResult<K extends TraceBraidRead> = Awaited<ReturnType<TraceBraidReadsRepository[K]>>;
type BraidOwnerRule<K extends TraceBraidRead> = (read: {
  params: BraidReadParams<K>;
  result: BraidReadResult<K>;
}) => Owners;

/** The braid reads, each returned only once the owners it shows are audited. */
export type AuditedTraceBraidReads = {
  readonly [K in TraceBraidRead]: (params: BraidReadParams<K>) => Promise<BraidReadResult<K>>;
};

/** A statement on a resource the fence opens to no braid ("traces"): it shows no owner's row. */
const noBraidedOwner = (): Owners => [];

/**
 * How each braid read names the owners whose spans its totals or counts come from. A read missing
 * here fails the build, so a new braid read under the reader's proof is audited (ADR-201 §8).
 */
const BRAID_OWNERS_OF: { readonly [K in TraceBraidRead]: BraidOwnerRule<K> } = {
  findReaderTraceIds: noBraidedOwner,
  countOwnerSpansInTraces: noBraidedOwner,
  findAttributeKeys: noBraidedOwner,
  countOwnerBraidActivity: noBraidedOwner,
  findOwnerSpansMarked: noBraidedOwner,
  countReaderBraidActivity: ({ params, result }) =>
    params.braids.flatMap((braid) =>
      (result.get(braid.braidId) ?? 0) > 0 ? [braid.ownerProjectId] : [],
    ),
  sumSpansInTrace: ({ params, result }) => {
    const reader = ownProjectIdReadBy(params.authorization);
    return result.flatMap((group) => (group.tenantId === reader ? [] : [group.tenantId]));
  },
};

/** Every braid read the trace module issues; the repository is never handed out. */
export const TRACE_BRAID_READS = Object.keys(BRAID_OWNERS_OF) as readonly TraceBraidRead[];

/**
 * The one door the trace module's span and braid reads pass through (ADR-201 §8, v1.10): a read
 * showing an owner's span, or totals or counts of them, records one braided spans viewed entry
 * first, or throws instead of returning. A read showing only the reader's spans records nothing.
 */
export class TraceBraidAuditedSpanReadService {
  static create(deps: {
    spans: TracesSpanReader;
    tree: TraceSpanTreeReads | undefined;
    braids: TraceBraidReadsRepository;
    audit: Pick<TraceBraidDetailService, "recordView">;
  }): TraceBraidAuditedSpanReadService {
    return new TraceBraidAuditedSpanReadService(deps);
  }

  readonly #spans: TracesSpanReader;
  readonly #tree: TraceSpanTreeReads | undefined;
  readonly #braids: TraceBraidReadsRepository;
  readonly #audit: Pick<TraceBraidDetailService, "recordView">;
  /** What the braid dialog, the Braids page and the trace header read through, never the store. */
  readonly braidReads: AuditedTraceBraidReads;

  private constructor(deps: {
    spans: TracesSpanReader;
    tree: TraceSpanTreeReads | undefined;
    braids: TraceBraidReadsRepository;
    audit: Pick<TraceBraidDetailService, "recordView">;
  }) {
    this.#spans = deps.spans;
    this.#tree = deps.tree;
    this.#braids = deps.braids;
    this.#audit = deps.audit;
    this.braidReads = {
      findReaderTraceIds: (params) => this.#readBraid("findReaderTraceIds", params),
      countOwnerSpansInTraces: (params) => this.#readBraid("countOwnerSpansInTraces", params),
      findAttributeKeys: (params) => this.#readBraid("findAttributeKeys", params),
      countOwnerBraidActivity: (params) => this.#readBraid("countOwnerBraidActivity", params),
      countReaderBraidActivity: (params) => this.#readBraid("countReaderBraidActivity", params),
      sumSpansInTrace: (params) => this.#readBraid("sumSpansInTrace", params),
      findOwnerSpansMarked: (params) => this.#readBraid("findOwnerSpansMarked", params),
    };
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

  async #readBraid<K extends TraceBraidRead>(
    method: K,
    params: BraidReadParams<K>,
  ): Promise<BraidReadResult<K>> {
    const reader = this.#braids[method] as (
      params: BraidReadParams<K>,
    ) => Promise<BraidReadResult<K>>;
    const result = await reader.call(this.#braids, params);
    const ownersOf = BRAID_OWNERS_OF[method] as BraidOwnerRule<K>;
    return this.#audited({
      authorization: (params as { authorization: Authorization }).authorization,
      ownerProjectIds: ownersOf({ params, result }),
      result,
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
