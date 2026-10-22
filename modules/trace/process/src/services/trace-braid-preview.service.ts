import {
  braidConditionTermsOf,
  isSpanBraidGrant,
  narrowAuthorization,
  ownProjectIdReadBy,
  withoutSpanBraids,
  type Authorization,
  type CompiledWhere,
} from "@langwatch/authorization";
import {
  BraidConditionRefusedError,
  compileBraidCondition,
  type AuthzApi,
  type AuthzBraid,
  type BraidConditionRefusal,
} from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";
import type {
  BraidActivity,
  BraidAttributeKeys,
  BraidPreview,
  BraidTestTrace,
  BraidTestTraceNode,
  SpanTreeNode,
} from "@langwatch/trace-contract";

import {
  NO_BRAID_TRACE_COUNTS,
  type BraidActivityRead,
  type BraidWindowRead,
  type TraceBraidReadsRepository,
} from "../repositories/trace-braid-reads.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** ADR-183 §7: the preview counts the reader's last 7 days of traces. */
export const BRAID_PREVIEW_WINDOW_MS = 7 * DAY_MS;
/** The most reader traces one preview counts; past it the answer says `capped`. */
export const BRAID_PREVIEW_TRACE_CAP = 10_000;
export const BRAID_ACTIVITY_WINDOW_MS = DAY_MS;
export const BRAID_ATTRIBUTE_KEYS_MAX = 200;
/** LangWatch's own attributes, verification marks included, are never offered as condition keys. */
export const BRAID_RESERVED_ATTRIBUTE_PREFIX = "langwatch.reserved.";

/** The reader's own spans of one trace, read as the span tree reads them. */
export type BraidReaderSpans = (input: {
  authorization: Authorization;
  traceId: string;
}) => Promise<SpanTreeNode[]>;

type Own = { projectId: string; authorization: Authorization };

/** One proof's own project, and the proof narrowed to it, never widened. */
function ownOf(authorization: Authorization): Own {
  const projectId = ownProjectIdReadBy(authorization);
  return {
    projectId,
    authorization: narrowAuthorization({ authorization, projectId }) ?? authorization,
  };
}

function refusalViewOf(refusal: BraidConditionRefusal): NonNullable<BraidPreview["refusal"]> {
  const { message } = new BraidConditionRefusedError({ refusal });
  return { message, at: refusal.at, construct: refusal.construct, fix: refusal.fix };
}

/**
 * The reader's live braids from the owner, as the reader's own proof carries them, each with its
 * own window; the braid being edited is left out, since the draft replaces it.
 */
function liveBraidsOf({
  reader,
  ownerProjectId,
  replacedBraidId,
}: {
  reader: Own;
  ownerProjectId: string;
  replacedBraidId: string | undefined;
}): BraidWindowRead[] {
  return reader.authorization.grants
    .filter((grant) => isSpanBraidGrant(grant) && grant.projectId === ownerProjectId)
    .filter((grant) => replacedBraidId === undefined || !grant.via.includes(replacedBraidId))
    .map((grant) => ({
      compiledWhere: grant.condition?.compiledWhere,
      readerProjectId: reader.projectId,
      fromMs: grant.condition?.from ?? 0,
      untilMs: grant.condition?.until ?? null,
    }));
}

const holdsVerified = (compiledWhere: CompiledWhere | undefined): boolean =>
  compiledWhere !== undefined &&
  braidConditionTermsOf(compiledWhere.tree).some((term) => term.kind === "verified");

/** A tree node without its spend: the dialog shows no cost, so no cost gate applies. */
function nodeOf(node: SpanTreeNode): SpanTreeNode {
  return {
    spanId: node.spanId,
    parentSpanId: node.parentSpanId,
    name: node.name,
    type: node.type,
    startTimeMs: node.startTimeMs,
    endTimeMs: node.endTimeMs,
    durationMs: node.durationMs,
    status: node.status,
    model: node.model,
    toolName: node.toolName ?? null,
    updatedAtMs: node.updatedAtMs ?? null,
  };
}

/**
 * The braid dialog's and the Braids page's reads (ADR-183 §7). Every read takes one proof per
 * project it reads: the reader's trace ids under the reader's, the owner's spans under the owner's.
 */
export class TraceBraidPreviewService {
  static create(deps: {
    reads: TraceBraidReadsRepository;
    readerSpans: BraidReaderSpans;
    braids: Pick<AuthzApi, "listBraids"> | null;
    now?: () => number;
  }): TraceBraidPreviewService {
    return new TraceBraidPreviewService(deps);
  }

  readonly #reads: TraceBraidReadsRepository;
  readonly #readerSpans: BraidReaderSpans;
  readonly #braids: Pick<AuthzApi, "listBraids"> | null;
  readonly #now: () => number;

  private constructor(deps: {
    reads: TraceBraidReadsRepository;
    readerSpans: BraidReaderSpans;
    braids: Pick<AuthzApi, "listBraids"> | null;
    now?: () => number;
  }) {
    this.#reads = deps.reads;
    this.#readerSpans = deps.readerSpans;
    this.#braids = deps.braids;
    this.#now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  /**
   * The reader's newest trace ids under its proof, then one statement under the owner's counting
   * those traces with the pair's live braids and the draft together and with the live ones alone,
   * and naming the example trace, which is then read as Test a trace reads one.
   */
  async preview(input: {
    ownerAuthorization: Authorization;
    readerAuthorization: Authorization;
    where?: string | undefined;
    fromMs: number;
    braidId?: string | undefined;
  }): Promise<BraidPreview> {
    const reader = ownOf(input.readerAuthorization);
    const owner = ownOf(input.ownerAuthorization);
    const live = liveBraidsOf({
      reader,
      ownerProjectId: owner.projectId,
      replacedBraidId: input.braidId,
    });
    const compiled = compileBraidCondition({ text: input.where ?? "" });
    if (!compiled.ok) {
      const traces = { every: 0, some: 0, none: 0, total: 0, capped: false };
      return {
        refusal: refusalViewOf(compiled),
        traces,
        spans: 0,
        live: { braids: live.length, traces, spans: 0 },
        unsignedHidden: null,
        example: null,
      };
    }
    const sinceMs = this.#now() - BRAID_PREVIEW_WINDOW_MS;
    const found = await this.#reads.findReaderTraceIds({
      authorization: reader.authorization,
      sinceMs,
      limit: BRAID_PREVIEW_TRACE_CAP + 1,
    });
    const capped = found.length > BRAID_PREVIEW_TRACE_CAP;
    const traceIds = found.slice(0, BRAID_PREVIEW_TRACE_CAP);
    const draft: BraidWindowRead = {
      compiledWhere: compiled.compiledWhere,
      readerProjectId: reader.projectId,
      fromMs: input.fromMs,
      untilMs: null,
    };
    const counts =
      traceIds.length === 0
        ? NO_BRAID_TRACE_COUNTS
        : await this.#reads.countOwnerSpansInTraces({
            authorization: owner.authorization,
            traceIds,
            sinceMs,
            live,
            draft,
          });
    const total = traceIds.length;
    const tracesOf = ({ every, some }: { every: number; some: number }) => ({
      every,
      some,
      none: Math.max(0, total - every - some),
      total,
      capped,
    });
    const { exampleTraceId } = counts;
    const exampleNodes =
      exampleTraceId === null
        ? null
        : await this.#asReaderSees({
            reader,
            owner,
            traceId: exampleTraceId,
            braids: [...live, draft],
          });
    return {
      refusal: null,
      traces: tracesOf(counts.shown),
      spans: counts.shown.spans,
      live: { braids: live.length, traces: tracesOf(counts.live), spans: counts.live.spans },
      unsignedHidden: holdsVerified(compiled.compiledWhere) ? counts.unsigned : null,
      example:
        exampleTraceId === null || exampleNodes === null
          ? null
          : { traceId: exampleTraceId, nodes: exampleNodes },
    };
  }

  async attributeKeys(input: { authorization: Authorization }): Promise<BraidAttributeKeys> {
    const keys = await this.#reads.findAttributeKeys({
      authorization: ownOf(input.authorization).authorization,
      sinceMs: this.#now() - BRAID_PREVIEW_WINDOW_MS,
      limit: BRAID_ATTRIBUTE_KEYS_MAX,
      excludedPrefix: BRAID_RESERVED_ATTRIBUTE_PREFIX,
    });
    return { keys };
  }

  /** Each braid counted on the page's own project with its proof; others' braids are left out. */
  async activity(input: {
    projectId: string;
    authorization: Authorization;
    braidIds: readonly string[];
  }): Promise<BraidActivity> {
    if (this.#braids === null || input.braidIds.length === 0) return { activity: [] };
    const listed = await this.#braids.listBraids({ projectId: input.projectId });
    const nowMs = this.#now();
    const sinceMs = nowMs - BRAID_ACTIVITY_WINDOW_MS;
    const wanted = new Set(input.braidIds);
    const readsOf = (braids: readonly AuthzBraid[]): BraidActivityRead[] =>
      braids.flatMap((braid) => {
        if (!wanted.has(braid.braidId)) return [];
        const compiled = compileBraidCondition({ text: braid.where ?? "" });
        if (!compiled.ok) return [];
        return [
          {
            braidId: braid.braidId,
            ownerProjectId: braid.ownerProjectId,
            readerProjectId: braid.readerProjectId,
            compiledWhere: compiled.compiledWhere,
            fromMs: Math.max(braid.fromMs, sinceMs),
            untilMs: Math.min(braid.expiresAtMs ?? nowMs + 1, nowMs + 1),
          },
        ];
      });
    const [asOwner, asReader] = await Promise.all([
      this.#reads.countOwnerBraidActivity({
        authorization: input.authorization,
        braids: readsOf(listed.intoOtherProjects),
        sinceMs,
      }),
      this.#reads.countReaderBraidActivity({
        authorization: input.authorization,
        braids: readsOf(listed.fromOtherProjects),
        sinceMs,
      }),
    ]);
    return {
      activity: input.braidIds.flatMap((braidId) => {
        const spanCount = asOwner.get(braidId) ?? asReader.get(braidId);
        return spanCount === undefined ? [] : [{ braidId, spanCount }];
      }),
    };
  }

  /**
   * One reader trace as the reader will see it: the owner's spans marked by the same braids the
   * count reads, the pair's live braids and the draft, the draft replacing the braid being edited.
   */
  async testTrace(input: {
    ownerAuthorization: Authorization;
    readerAuthorization: Authorization;
    where?: string | undefined;
    fromMs: number;
    traceId: string;
    braidId?: string | undefined;
  }): Promise<BraidTestTrace> {
    const compiled = compileBraidCondition({ text: input.where ?? "" });
    if (!compiled.ok) throw new BraidConditionRefusedError({ refusal: compiled });
    const reader = ownOf(input.readerAuthorization);
    const owner = ownOf(input.ownerAuthorization);
    const live = liveBraidsOf({
      reader,
      ownerProjectId: owner.projectId,
      replacedBraidId: input.braidId,
    });
    const draft: BraidWindowRead = {
      compiledWhere: compiled.compiledWhere,
      readerProjectId: reader.projectId,
      fromMs: input.fromMs,
      untilMs: null,
    };
    const nodes = await this.#asReaderSees({
      reader,
      owner,
      traceId: input.traceId,
      braids: [...live, draft],
    });
    return nodes === null ? { found: false, nodes: [] } : { found: true, nodes };
  }

  /** The reader's own spans, then the owner's in that trace marked; null if the reader has none. */
  async #asReaderSees(input: {
    reader: Own;
    owner: Own;
    traceId: string;
    braids: readonly BraidWindowRead[];
  }): Promise<BraidTestTraceNode[] | null> {
    const readerNodes = await this.#readerSpans({
      authorization: withoutSpanBraids(input.reader.authorization),
      traceId: input.traceId,
    });
    if (readerNodes.length === 0) return null;
    const ownerSpans = await this.#reads.findOwnerSpansMarked({
      authorization: input.owner.authorization,
      traceId: input.traceId,
      braids: input.braids,
    });
    const nodes: BraidTestTraceNode[] = [
      ...readerNodes.map(nodeOf),
      ...ownerSpans.map((span) => ({
        ...nodeOf(span),
        ownerProjectId: input.owner.projectId,
        braided: span.braided,
      })),
    ];
    return nodes.toSorted((a, b) => a.startTimeMs - b.startTimeMs);
  }
}
