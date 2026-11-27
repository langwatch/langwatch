import type {
  DerivedTraceEvent,
  OwnedSpan,
  Protections,
  Span,
  SpanTreeNode,
  TraceApi,
} from "@langwatch/trace-contract";

import {
  protectSpans,
  type TraceReadMapperMembers,
} from "../../../rules/trace-read-mappers.rules.ts";
import { gateTreeCostByOwner } from "../../../rules/trace-view-gates.rules.ts";
import { ownerAudienceNamed, protectByOwner } from "../../braid/rules/braided-span-owner.rules.ts";
import type { TraceBraidDetailService } from "./trace-braid-detail.service.ts";

type TraceOwnerProtectionsDependencies = Readonly<{
  reads: Pick<TraceApi, "resolveViewerProtections">;
  braids: Pick<TraceBraidDetailService, "ownerName">;
  mappers: Pick<TraceReadMapperMembers, "spanProtection">;
}>;

/**
 * The drawer's per-owner protection (ADR-201 §5): each braid owner's protections for the viewer,
 * applied to the items that owner holds while the reader's own items keep the reader's.
 */
export class TraceOwnerProtectionsService {
  private constructor(private readonly deps: TraceOwnerProtectionsDependencies) {}

  static create(deps: TraceOwnerProtectionsDependencies): TraceOwnerProtectionsService {
    return new TraceOwnerProtectionsService(deps);
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
          [projectId, await this.#ownerProtectionsOf({ projectId, viewerUserId })] as const,
      ),
    );
    return new Map(resolved);
  }

  async protectSpans({
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

  async protectEvents({
    viewerUserId,
    events,
    reader,
  }: {
    viewerUserId: string;
    events: DerivedTraceEvent[];
    reader: Protections;
  }): Promise<DerivedTraceEvent[]> {
    const owners = await this.ownerProtections({
      viewerUserId,
      ownerProjectIds: events.map((event) => event.ownerProjectId),
    });
    return protectByOwner({
      items: events,
      reader,
      owners,
      protect: (group, groupProtections) =>
        this.deps.mappers.spanProtection.applyDerivedTraceEventProtections(group, groupProtections),
    });
  }

  async gateTreeCost({
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

  async #ownerProtectionsOf({
    projectId,
    viewerUserId,
  }: {
    projectId: string;
    viewerUserId: string;
  }): Promise<Protections> {
    const [protections, ownerName] = await Promise.all([
      this.deps.reads.resolveViewerProtections({ projectId, userId: viewerUserId }),
      this.deps.braids.ownerName({ ownerProjectId: projectId }),
    ]);
    return ownerAudienceNamed({ protections, ownerName });
  }
}
