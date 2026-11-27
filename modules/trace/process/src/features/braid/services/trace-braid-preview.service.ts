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
  type AuthzApi,
  type AuthzBraid,
  type BraidConditionRefusal,
} from "@langwatch/authz-contract";
import { compileBraidCondition } from "@langwatch/authz-contract/braid-condition-compiler";
import { nowInstant } from "@langwatch/time";
import {
  ClickHouseOverloadedError,
  type BraidActivity,
  type BraidAttributeKeys,
  type BraidPreview,
  type BraidTestTrace,
  type BraidTestTraceNode,
  type SpanTreeNode,
} from "@langwatch/trace-contract";

import {
  NO_BRAID_TRACE_COUNTS,
  type BraidActivityRead,
  type BraidWindowRead,
} from "../repositories/trace-braid-reads.repository.ts";
import { heldTraceIdsOf, readerHoldsTrace } from "../rules/braid-held-trace.rules.ts";
import type { AuditedTraceBraidReads } from "./trace-braid-audited-span-read.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** ADR-201 §7: the preview counts the reader's last 7 days of traces. */
export const BRAID_PREVIEW_WINDOW_MS = 7 * DAY_MS;
/** The most reader traces one preview counts; past it the answer says `capped`. */
export const BRAID_PREVIEW_TRACE_CAP = 10_000;
/** The most parent span keys one side's held-trace read returns before the preview says capped. */
export const BRAID_PREVIEW_LINK_CAP = 50_000;
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

type BraidPreviewInput = {
  ownerAuthorization: Authorization;
  readerAuthorization: Authorization;
  where?: string | undefined;
  fromMs: number;
  braidId?: string | undefined;
};
type BraidTestTraceInput = BraidPreviewInput & { traceId: string };
type BraidActivityInput = {
  projectId: string;
  authorization: Authorization;
  braidIds: readonly string[];
};

/** One proof's own project, and the proof narrowed to it, never widened. */
function ownOf(authorization: Authorization): Own {
  const projectId = ownProjectIdReadBy(authorization);
  return {
    projectId,
    authorization: narrowAuthorization({ authorization, projectId }),
  };
}

const OVERLOAD_TYPES = ["MEMORY_LIMIT_EXCEEDED", "TIMEOUT_EXCEEDED"];

/** ClickHouse past a read's memory or time cap: overloaded, which a retry soon may get past. */
function isOverloaded(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    OVERLOAD_TYPES.some((type) => error.message.includes(type)) ||
    message.includes("memory limit exceeded") ||
    message.includes("timeout exceeded") ||
    OVERLOAD_TYPES.includes((error as { type?: string }).type ?? "")
  );
}

/** These reads' overload answers as the named retryable error, not an unknown one (#9682 D5). */
async function overloadNamed<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isOverloaded(error)) throw new ClickHouseOverloadedError({ reasons: [error as Error] });
    throw error;
  }
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

/**
 * The live fence's link floor (ADR-201 §3, `heldTraceOf`): spans on either side link only from
 * the earliest window of every braid into the reader, any owner's, the draft replacing the edited.
 */
function heldFromOf({
  reader,
  replacedBraidId,
  draftFromMs,
}: {
  reader: Own;
  replacedBraidId: string | undefined;
  draftFromMs: number;
}): number {
  const froms = reader.authorization.grants
    .filter((grant) => isSpanBraidGrant(grant))
    .filter((grant) => replacedBraidId === undefined || !grant.via.includes(replacedBraidId))
    .map((grant) => grant.condition?.from ?? 0);
  return Math.min(draftFromMs, ...froms);
}

/** A refused condition's preview: the refusal, and nothing counted. */
function refusedPreviewOf({
  refusal,
  liveBraids,
}: {
  refusal: BraidConditionRefusal;
  liveBraids: number;
}): BraidPreview {
  const traces = { every: 0, some: 0, none: 0, total: 0, capped: false };
  return {
    refusal: refusalViewOf(refusal),
    traces,
    spans: 0,
    live: { braids: liveBraids, traces, spans: 0 },
    unsignedHidden: null,
    example: null,
  };
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
 * The braid dialog's and the Braids page's reads (ADR-201 §7). Every read takes one proof per
 * project it reads: the reader's trace ids under the reader's, the owner's spans under the owner's.
 * Each asks `release_braids` first, as braid management does (braids-release-flag.feature).
 */
export class TraceBraidPreviewService {
  static create(deps: {
    reads: AuditedTraceBraidReads;
    readerSpans: BraidReaderSpans;
    braids: Pick<AuthzApi, "listBraids" | "assertBraidsReleased">;
    now?: () => number;
  }): TraceBraidPreviewService {
    return new TraceBraidPreviewService(deps);
  }

  readonly #reads: AuditedTraceBraidReads;
  readonly #readerSpans: BraidReaderSpans;
  readonly #braids: Pick<AuthzApi, "listBraids" | "assertBraidsReleased">;
  readonly #now: () => number;

  private constructor(deps: {
    reads: AuditedTraceBraidReads;
    readerSpans: BraidReaderSpans;
    braids: Pick<AuthzApi, "listBraids" | "assertBraidsReleased">;
    now?: () => number;
  }) {
    this.#reads = deps.reads;
    this.#readerSpans = deps.readerSpans;
    this.#braids = deps.braids;
    this.#now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  preview(input: BraidPreviewInput): Promise<BraidPreview> {
    return overloadNamed(() => this.#previewRead(input));
  }

  attributeKeys(input: { authorization: Authorization }): Promise<BraidAttributeKeys> {
    return overloadNamed(() => this.#attributeKeysRead(input));
  }

  activity(input: BraidActivityInput): Promise<BraidActivity> {
    return overloadNamed(() => this.#activityRead(input));
  }

  testTrace(input: BraidTestTraceInput): Promise<BraidTestTrace> {
    return overloadNamed(() => this.#testTraceRead(input));
  }

  /**
   * The reader's newest trace ids under its proof, then one statement under the owner's counting
   * those traces with the pair's live braids and the draft together and with the live ones alone,
   * and naming the example trace, which is then read as Test a trace reads one.
   */
  async #previewRead(input: BraidPreviewInput): Promise<BraidPreview> {
    const reader = ownOf(input.readerAuthorization);
    const owner = ownOf(input.ownerAuthorization);
    await this.#braids.assertBraidsReleased({ projectId: owner.projectId });
    const live = liveBraidsOf({
      reader,
      ownerProjectId: owner.projectId,
      replacedBraidId: input.braidId,
    });
    const compiled = compileBraidCondition({ text: input.where ?? "" });
    if (!compiled.ok) return refusedPreviewOf({ refusal: compiled, liveBraids: live.length });
    const sinceMs = this.#now() - BRAID_PREVIEW_WINDOW_MS;
    const found = await this.#reads.findReaderTraceIds({
      authorization: reader.authorization,
      sinceMs,
      limit: BRAID_PREVIEW_TRACE_CAP + 1,
    });
    const traceIds = found.slice(0, BRAID_PREVIEW_TRACE_CAP);
    const heldFromMs = heldFromOf({
      reader,
      replacedBraidId: input.braidId,
      draftFromMs: input.fromMs,
    });
    const held = await this.#heldTraceIds({
      reader,
      owner,
      traceIds,
      sinceMs: Math.max(sinceMs, heldFromMs),
    });
    const capped = found.length > BRAID_PREVIEW_TRACE_CAP || held.capped;
    const draft: BraidWindowRead = {
      compiledWhere: compiled.compiledWhere,
      readerProjectId: reader.projectId,
      fromMs: input.fromMs,
      untilMs: null,
    };
    const counts =
      held.traceIds.length === 0
        ? NO_BRAID_TRACE_COUNTS
        : await this.#reads.countOwnerSpansInTraces({
            authorization: owner.authorization,
            traceIds: held.traceIds,
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
            heldFromMs,
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

  async #attributeKeysRead(input: { authorization: Authorization }): Promise<BraidAttributeKeys> {
    const own = ownOf(input.authorization);
    await this.#braids.assertBraidsReleased({ projectId: own.projectId });
    const keys = await this.#reads.findAttributeKeys({
      authorization: own.authorization,
      sinceMs: this.#now() - BRAID_PREVIEW_WINDOW_MS,
      limit: BRAID_ATTRIBUTE_KEYS_MAX,
      excludedPrefix: BRAID_RESERVED_ATTRIBUTE_PREFIX,
    });
    return { keys };
  }

  /** Each braid counted on the page's own project with its proof; others' braids are left out. */
  async #activityRead(input: BraidActivityInput): Promise<BraidActivity> {
    await this.#braids.assertBraidsReleased({ projectId: input.projectId });
    if (input.braidIds.length === 0) return { activity: [] };
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
  async #testTraceRead(input: BraidTestTraceInput): Promise<BraidTestTrace> {
    const reader = ownOf(input.readerAuthorization);
    const owner = ownOf(input.ownerAuthorization);
    await this.#braids.assertBraidsReleased({ projectId: owner.projectId });
    const compiled = compileBraidCondition({ text: input.where ?? "" });
    if (!compiled.ok) throw new BraidConditionRefusedError({ refusal: compiled });
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
      heldFromMs: heldFromOf({ reader, replacedBraidId: input.braidId, draftFromMs: input.fromMs }),
    });
    return nodes === null ? { found: false, nodes: [] } : { found: true, nodes };
  }

  /**
   * The reader traces held for the owner (ADR-201 §3): each side's parents outside itself, matched
   * against the other side's own spans under its own proof, both from the fence's link floor.
   */
  async #heldTraceIds(input: {
    reader: Own;
    owner: Own;
    traceIds: readonly string[];
    sinceMs: number;
  }): Promise<{ traceIds: string[]; capped: boolean }> {
    if (input.traceIds.length === 0) return { traceIds: [], capped: false };
    const parentsOf = (side: Own) =>
      this.#reads.findOutsideParents({
        authorization: side.authorization,
        traceIds: input.traceIds,
        sinceMs: input.sinceMs,
        limit: BRAID_PREVIEW_LINK_CAP,
      });
    const [readerParents, ownerParents] = await Promise.all([
      parentsOf(input.reader),
      parentsOf(input.owner),
    ]);
    const [heldThroughReader, heldThroughOwner] = await Promise.all([
      this.#reads.findTracesHoldingSpans({
        authorization: input.reader.authorization,
        spans: ownerParents,
        sinceMs: input.sinceMs,
      }),
      this.#reads.findTracesHoldingSpans({
        authorization: input.owner.authorization,
        spans: readerParents,
        sinceMs: input.sinceMs,
      }),
    ]);
    return {
      traceIds: heldTraceIdsOf({ traceIds: input.traceIds, heldThroughReader, heldThroughOwner }),
      capped: [readerParents, ownerParents].some((keys) => keys.length >= BRAID_PREVIEW_LINK_CAP),
    };
  }

  /** The reader's own spans, then the owner's in that trace marked; null if the reader has none. */
  async #asReaderSees(input: {
    reader: Own;
    owner: Own;
    traceId: string;
    braids: readonly BraidWindowRead[];
    heldFromMs: number;
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
    const held = readerHoldsTrace({
      readerSpans: readerNodes,
      ownerSpans,
      fromMs: input.heldFromMs,
    });
    const nodes: BraidTestTraceNode[] = [
      ...readerNodes.map(nodeOf),
      ...ownerSpans.map((span) => ({
        ...nodeOf(span),
        ownerProjectId: input.owner.projectId,
        braided: held && span.braided,
      })),
    ];
    return nodes.toSorted((a, b) => a.startTimeMs - b.startTimeMs);
  }
}
