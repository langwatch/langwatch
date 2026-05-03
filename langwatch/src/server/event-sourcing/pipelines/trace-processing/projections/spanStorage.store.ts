import { GovernanceContentStripService } from "@ee/governance/services/governanceContentStrip.service";

import type { SpanStorageRepository } from "~/server/app-layer/traces/repositories/span-storage.repository";
import type { SpanInsertData } from "~/server/app-layer/traces/types";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { NormalizedSpan } from "../schemas/spans";

/**
 * Maps a pipeline NormalizedSpan to the app-layer SpanInsertData.
 */
function toAppLayer(span: NormalizedSpan): SpanInsertData {
  return {
    id: span.id,
    tenantId: span.tenantId,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    parentTraceId: span.parentTraceId,
    parentIsRemote: span.parentIsRemote,
    sampled: span.sampled,
    startTimeUnixMs: span.startTimeUnixMs,
    endTimeUnixMs: span.endTimeUnixMs,
    durationMs: span.durationMs,
    name: span.name,
    kind: span.kind as number,
    resourceAttributes: span.resourceAttributes as Record<string, unknown>,
    spanAttributes: span.spanAttributes as Record<string, unknown>,
    statusCode: span.statusCode as number | null,
    statusMessage: span.statusMessage,
    instrumentationScope: {
      name: span.instrumentationScope.name,
      version: span.instrumentationScope.version ?? undefined,
    },
    events: span.events.map((e) => ({
      name: e.name,
      timeUnixMs: e.timeUnixMs,
      attributes: e.attributes as Record<string, unknown>,
    })),
    links: span.links.map((l) => ({
      traceId: l.traceId,
      spanId: l.spanId,
      attributes: l.attributes as Record<string, unknown>,
    })),
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/**
 * Phase 9 — apply receiver-side content stripping ("no-spy mode") for
 * gateway-origin spans before the CH write. Non-gateway-origin spans
 * are returned untouched.
 *
 * The strip transform runs HERE (in the AppendStore) rather than in
 * the upstream MapProjection because the projection's mapXxx handlers
 * are sync and the org-mode lookup is async (Prisma). The store layer
 * is async by contract, so this is the cleanest extension point that
 * still guarantees the policy fires BEFORE the ClickHouse write.
 */
async function applyGovernanceStrip(
  span: NormalizedSpan,
  stripService: GovernanceContentStripService,
): Promise<NormalizedSpan> {
  const orgId = GovernanceContentStripService.governanceTargetOrgId(
    span.spanAttributes as Record<string, unknown>,
  );
  if (!orgId) return span;
  const mode = await stripService.modeForOrganization(orgId);
  if (mode === "full") return span;
  const strippedAttrs = GovernanceContentStripService.stripSpanAttributes({
    attributes: span.spanAttributes as Record<string, unknown>,
    mode,
  });
  const strippedEvents = span.events.map((e) => ({
    ...e,
    attributes: GovernanceContentStripService.stripEventAttributes({
      attributes: e.attributes as Record<string, unknown>,
      mode,
    }),
  }));
  return {
    ...span,
    spanAttributes: strippedAttrs,
    events: strippedEvents,
  };
}

/**
 * Thin AppendStore adapter for span storage.
 * Converts pipeline NormalizedSpan → app-layer SpanInsertData and delegates to SpanStorageRepository.
 */
export class SpanAppendStore implements AppendStore<NormalizedSpan> {
  constructor(
    private readonly repo: SpanStorageRepository,
    private readonly stripService: GovernanceContentStripService = GovernanceContentStripService.create(),
  ) {}

  async append(
    record: NormalizedSpan,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    const transformed = await applyGovernanceStrip(record, this.stripService);
    await this.repo.insertSpan(toAppLayer(transformed));
  }

  async bulkAppend(
    records: NormalizedSpan[],
    _context: ProjectionStoreContext,
  ): Promise<void> {
    if (records.length === 0) return;
    const transformed = await Promise.all(
      records.map((r) => applyGovernanceStrip(r, this.stripService)),
    );
    await this.repo.insertSpans(transformed.map(toAppLayer));
  }
}
