import {
  type Authorization,
  narrowAuthorization,
  ownProjectIdReadBy,
} from "@langwatch/authorization";
import {
  traceSummaryReadSchema,
  type DerivedTraceEvent,
  type Protections,
  type OwnedSpan,
  type Span,
  type SpanDetail,
  type SpanTreeDeltaInput,
  type SpanTreeInput,
  type SpanTreeNode,
  type SpanTreePage,
  type TraceApi,
  type TraceDrawerReadInput,
  type TraceHeader,
  type TraceResourceInfoDto,
} from "@langwatch/trace-contract";

import {
  deriveTraceDropPrivacy,
  mapLegacySpanSummaryToTreeNode,
  mapSpanDetailsByOwner,
  mapTraceSummaryToHeader,
  protectSpans,
  redactV2Content,
  type TraceReadMapperMembers,
} from "../../../rules/trace-read-mappers.rules.ts";
import {
  gateHeaderCost,
  gateTreeCostByOwner,
  resourceInfoOf,
} from "../../../rules/trace-view-gates.rules.ts";
import {
  protectByOwner,
  readsBraidedSpans,
  verifiedMarksOf,
} from "../../braid/rules/braided-span-owner.rules.ts";
import { braidedTraceSummaryOf } from "../../braid/rules/braided-trace-totals.rules.ts";
import type { TraceBraidDetailService } from "./trace-braid-detail.service.ts";
import type { TraceBraidedTotalsService } from "./trace-braided-totals.service.ts";

/** The trace reads a drawer view is assembled from: the module's own, under the route's proof. */
type TraceDrawerReads = Pick<
  TraceApi,
  | "authorizationForTrace"
  | "resolveViewerProtections"
  | "readTraceSummary"
  | "readSpansPage"
  | "readSpansSince"
  | "readSpanTreePage"
  | "readSpanTreeDelta"
  | "readSpanSummaries"
  | "readSpans"
  | "enrichSpansFromCodingAgentLogs"
  | "readSpanResources"
  | "readTraceEvents"
>;

type TraceDrawerReadDependencies = Readonly<{
  reads: TraceDrawerReads;
  braids: TraceBraidDetailService;
  totals: TraceBraidedTotalsService;
  mappers: TraceReadMapperMembers;
}>;

/** The proof narrowed to the trace's member and the reader's protections there. */
type OpenedTrace = Readonly<{ authorization: Authorization; protections: Protections }>;

/**
 * The drawer's views of a trace (ADR-201 §5): each braided item is protected by its owner's
 * protections and the reader's by theirs. The paged and live reads audit before they return an
 * owner's span (§8), so a view that cannot be audited fails rather than show it.
 */
export class TraceDrawerReadService {
  private constructor(private readonly deps: TraceDrawerReadDependencies) {}

  static create(deps: TraceDrawerReadDependencies): TraceDrawerReadService {
    return new TraceDrawerReadService(deps);
  }

  async header(input: TraceDrawerReadInput & { full?: boolean | undefined }): Promise<TraceHeader> {
    const { reads, mappers } = this.deps;
    const protections = await reads.resolveViewerProtections({
      projectId: input.projectId,
      userId: input.viewerUserId,
      authorization: input.authorization,
    });
    const summary = traceSummaryReadSchema.parse(
      await reads.readTraceSummary({
        authorization: input.authorization,
        traceId: input.traceId,
        tenantId: input.tenantId,
        occurredAtMs: input.occurredAtMs,
        visibilityCutoffMs: protections.visibilityCutoffMs,
        full: input.full,
      }),
    );
    const rawHeader = mapTraceSummaryToHeader(summary);
    // Privacy follows the member the trace was found in (ADR-177 decision 9).
    const memberProtections = await reads.resolveViewerProtections({
      projectId: input.projectId,
      userId: input.viewerUserId,
      authorization: narrowAuthorization({
        authorization: input.authorization,
        projectId: summary.tenantId,
      }),
    });
    const header = gateHeaderCost({
      header: redactV2Content(rawHeader, memberProtections, mappers.contentPrivacy),
      protections: memberProtections,
    });
    return {
      ...header,
      privacy: await deriveTraceDropPrivacy(rawHeader, summary.tenantId, mappers.contentPrivacy),
      projectId: summary.tenantId,
      ...(await this.#braidedTotals({
        ...input,
        tenantId: summary.tenantId,
        header,
        canSeeCosts: memberProtections.canSeeCosts === true,
      })),
    };
  }

  async spansPage(
    input: TraceDrawerReadInput & { limit: number; offset: number },
  ): Promise<{ spans: Span[]; total: number }> {
    const { authorization, protections } = await this.#open(input);
    const page = await this.deps.reads.readSpansPage({
      authorization,
      traceId: input.traceId,
      visibilityCutoffMs: protections.visibilityCutoffMs,
      limit: input.limit,
      offset: input.offset,
      occurredAtMs: input.occurredAtMs,
      reads: "spans",
    });
    return {
      ...page,
      spans: await this.#protectSpans({ ...input, spans: page.spans, reader: protections }),
    };
  }

  async spansSince(input: TraceDrawerReadInput & { sinceStartTimeMs: number }): Promise<Span[]> {
    const { authorization, protections } = await this.#open(input);
    const spans = await this.deps.reads.readSpansSince({
      authorization,
      traceId: input.traceId,
      sinceStartTimeMs: input.sinceStartTimeMs,
      visibilityCutoffMs: protections.visibilityCutoffMs,
      occurredAtMs: input.occurredAtMs,
      reads: "spans",
    });
    return this.#protectSpans({ ...input, spans, reader: protections });
  }

  async spanTreePage(
    input: TraceDrawerReadInput & Omit<SpanTreeInput, "canSeeCosts">,
  ): Promise<SpanTreePage> {
    const { authorization: _route, viewerUserId, ...tree } = input;
    const { authorization, protections } = await this.#open(input);
    // Priced in full here, then each span's cost is gated by its owner (ADR-201 §5).
    const page = await this.deps.reads.readSpanTreePage({
      ...tree,
      authorization,
      canSeeCosts: true,
    });
    return {
      ...page,
      nodes: await this.#gateTreeCost({ viewerUserId, nodes: page.nodes, reader: protections }),
    };
  }

  async spanTreeDelta(
    input: TraceDrawerReadInput & Omit<SpanTreeDeltaInput, "canSeeCosts">,
  ): Promise<SpanTreeNode[]> {
    const { authorization: _route, viewerUserId, ...tree } = input;
    const { authorization, protections } = await this.#open(input);
    const nodes = await this.deps.reads.readSpanTreeDelta({
      ...tree,
      authorization,
      canSeeCosts: true,
    });
    return this.#gateTreeCost({ viewerUserId, nodes, reader: protections });
  }

  async spanTree(input: TraceDrawerReadInput): Promise<SpanTreeNode[]> {
    const { authorization, protections } = await this.#open(input);
    const rows = await this.deps.reads.readSpanSummaries({
      authorization,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      reads: "spans",
    });
    return this.#gateTreeCost({
      viewerUserId: input.viewerUserId,
      nodes: rows.map(mapLegacySpanSummaryToTreeNode),
      reader: protections,
    });
  }

  async spansFull(input: TraceDrawerReadInput): Promise<SpanDetail[]> {
    const { reads, braids, mappers } = this.deps;
    const { authorization, protections } = await this.#open(input);
    const storedSpans = await reads.readSpans({
      authorization,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      visibilityCutoffMs: protections.visibilityCutoffMs,
      reads: "spans",
    });
    // Coding-agent message content lives in the trace's OTLP log records; joined on BEFORE
    // protections run, so it goes through the same redaction pass.
    const spans = await reads.enrichSpansFromCodingAgentLogs({
      projectId: input.projectId,
      traceId: input.traceId,
      spans: storedSpans,
      ...(input.occurredAtMs !== undefined ? { occurredAtMs: input.occurredAtMs } : {}),
    });
    const [owners, spanBraids] = await Promise.all([
      this.ownerProtections({
        viewerUserId: input.viewerUserId,
        ownerProjectIds: spans.map((span) => span.ownerProjectId),
      }),
      braids.describeSpans({
        readerProjectId: ownProjectIdReadBy(authorization),
        viewerUserId: input.viewerUserId,
        spans: spans.map((span) => ({
          ownerProjectId: span.ownerProjectId,
          startedAtMs: span.timestamps.started_at,
          verifiedMarks: verifiedMarksOf({ params: span.params }),
        })),
      }),
    ]);
    return mapSpanDetailsByOwner({
      spans,
      protections,
      owners,
      braids: spanBraids,
      ports: mappers,
    });
  }

  async resources(input: TraceDrawerReadInput): Promise<TraceResourceInfoDto> {
    const { authorization, protections } = await this.#open(input);
    const rows = await this.deps.reads.readSpanResources({
      authorization,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      reads: "spans",
    });
    const ownerProtections = await this.ownerProtections({
      viewerUserId: input.viewerUserId,
      ownerProjectIds: rows.map((row) => row.ownerProjectId),
    });
    return resourceInfoOf({ rows, protections, ownerProtections });
  }

  async traceEvents(input: TraceDrawerReadInput): Promise<DerivedTraceEvent[]> {
    const { authorization, protections } = await this.#open(input);
    const events = await this.deps.reads.readTraceEvents({
      authorization,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      reads: "spans",
    });
    const owners = await this.ownerProtections({
      viewerUserId: input.viewerUserId,
      ownerProjectIds: events.map((event) => event.ownerProjectId),
    });
    return protectByOwner({
      items: events,
      reader: protections,
      owners,
      protect: (group, groupProtections) =>
        this.deps.mappers.spanProtection.applyDerivedTraceEventProtections(group, groupProtections),
    });
  }

  /** Each braid owner's protections for this viewer: its policy, the viewer's standing there. */
  async ownerProtections({
    viewerUserId,
    ownerProjectIds,
  }: {
    viewerUserId: string;
    ownerProjectIds: readonly (string | null | undefined)[];
  }): Promise<ReadonlyMap<string, Protections>> {
    const owners = [...new Set(ownerProjectIds.filter((id): id is string => !!id))];
    const resolved = await Promise.all(
      owners.map(
        async (projectId) =>
          [
            projectId,
            await this.deps.reads.resolveViewerProtections({ projectId, userId: viewerUserId }),
          ] as const,
      ),
    );
    return new Map(resolved);
  }

  async #open(input: TraceDrawerReadInput): Promise<OpenedTrace> {
    const authorization = await this.deps.reads.authorizationForTrace({
      authorization: input.authorization,
      traceId: input.traceId,
      tenantId: input.tenantId,
    });
    const protections = await this.deps.reads.resolveViewerProtections({
      projectId: input.projectId,
      userId: input.viewerUserId,
      authorization,
    });
    return { authorization, protections };
  }

  async #protectSpans({
    viewerUserId,
    spans,
    reader,
  }: {
    viewerUserId: string;
    spans: readonly OwnedSpan[];
    reader: Protections;
  }): Promise<Span[]> {
    const owners = await this.ownerProtections({
      viewerUserId,
      ownerProjectIds: spans.map((span) => span.ownerProjectId),
    });
    return protectByOwner({
      items: spans,
      reader,
      owners,
      protect: (group, groupProtections) =>
        protectSpans({
          spans: group,
          protections: groupProtections,
          spanProtection: this.deps.mappers.spanProtection,
        }),
    });
  }

  async #gateTreeCost({
    viewerUserId,
    nodes,
    reader,
  }: {
    viewerUserId: string;
    nodes: SpanTreeNode[];
    reader: Protections;
  }): Promise<SpanTreeNode[]> {
    const owners = await this.ownerProtections({
      viewerUserId,
      ownerProjectIds: nodes.map((node) => node.ownerProjectId),
    });
    return gateTreeCostByOwner({ nodes, reader, owners });
  }

  /**
   * The header's `braided`: whole-trace totals with the braided spans the reader sees, and their
   * owners. A trace without them, or a proof without braids, adds nothing and sends no statement;
   * each owner's cost counts only where its own protections show this viewer cost.
   */
  async #braidedTotals(
    input: TraceDrawerReadInput & { tenantId: string; header: TraceHeader; canSeeCosts: boolean },
  ): Promise<Pick<TraceHeader, "braided">> {
    if (!readsBraidedSpans(input.authorization)) return {};
    const totals = await this.deps.totals.ownerTotals({
      authorization: await this.deps.reads.authorizationForTrace(input),
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs ?? input.header.timestamp,
    });
    if (totals.length === 0) return {};
    const ownerProjectIds = totals.map((owner) => owner.ownerProjectId);
    const [owners, ownerProtections] = await Promise.all([
      this.deps.braids.describeOwners({ ownerProjectIds, viewerUserId: input.viewerUserId }),
      this.ownerProtections({ viewerUserId: input.viewerUserId, ownerProjectIds }),
    ]);
    return {
      braided: braidedTraceSummaryOf({
        header: input.header,
        owners,
        totals,
        canSeeCosts: input.canSeeCosts,
        costVisibleOwners: new Set(
          ownerProjectIds.filter((id) => ownerProtections.get(id)?.canSeeCosts === true),
        ),
      }),
    };
  }
}
