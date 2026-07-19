/**
 * Edge media extraction for trace spans.
 *
 * `maybeExtractSpanMedia` runs inside the processCommandData edge hook
 * (TraceRequestCollectionService), after the span is normalized and BEFORE
 * the ADR-022 `maybeSpool` size check. It walks the span's attribute values
 * (and span-event attribute values) for inline media parts — base64 audio
 * turns, data-URI images, file attachments — and externalizes their bytes to
 * the content-addressed stored-objects store, rewriting each part to a
 * lightweight `/api/files/{projectId}/{id}` reference.
 *
 * Ordering rationale: extracting the heavy media part FIRST usually brings
 * the remaining payload back under COMMAND_INLINE_THRESHOLD, so the
 * transient whole-payload spool (PUT + GET + DELETE) is replaced by a single
 * permanent, deduplicated PUT. A scenario run's recording and the same
 * recording observed on its trace hash to the same stored object — stored
 * once, referenced from both.
 *
 * Receiving guarantee: the whole function is fail-open. The cheap media
 * marker gate keeps the no-media hot path free of any I/O; every stage that
 * can fail (flag store, data-privacy probe, object store) falls back to the
 * unmodified command data with a warn log and a fail-open counter, so
 * ingestion is never blocked and the worst case is today's inline behavior.
 * Content-addressed PUTs are idempotent, so SDK retries and queue re-stages
 * never double-store.
 *
 * Privacy interlock: the data-privacy content drop runs later, at the
 * RecordSpanCommand choke point. Persisting media bytes at the edge for a
 * project whose policy then drops that content would retain what the policy
 * discards — so any project with drop rules skips extraction entirely and
 * keeps today's behavior end to end.
 */

import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import {
  computeDropMatchers,
  computeDroppedKeys,
  rolesDroppedFromChatArrays,
} from "~/server/data-privacy/dropKeyCatalog";
import type { RecordSpanCommandData } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import type {
  OtlpKeyValue,
  OtlpSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";
import { featureFlagService } from "~/server/featureFlag";
import { getEdgeMediaExtractFailOpenCounter } from "~/server/metrics";
import type { ExtractedRef } from "~/server/stored-objects/content-extractor";
import { containsMediaMarkers } from "~/server/stored-objects/media-markers";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { extractInlineMediaFromValue } from "~/server/stored-objects/value-media-extractor";

/** Purpose tag for stored objects extracted from trace span content. */
export const TRACE_MEDIA_PURPOSE = "trace_content";

/** Structured logger surface used by the extraction hook. */
export interface EdgeMediaExtractionLogger {
  info(context: Record<string, unknown>, msg: string): void;
  warn(context: Record<string, unknown>, msg: string): void;
}

/** Injectable dependencies; production defaults fill any omitted field. */
export interface EdgeMediaExtractionDeps {
  /** Per-project flag read for `release_trace_media_extraction`. */
  isEnabled: (projectId: string) => Promise<boolean>;
  /** True when the project's resolved data-privacy policy drops any span content. */
  hasContentDropRules: (projectId: string) => Promise<boolean>;
  /** Stored-objects service factory scoped to the owning project. */
  createService: (projectId: string) => StoredObjectsService;
}

async function defaultIsEnabled(projectId: string): Promise<boolean> {
  // Read through the layered service, NOT the raw postgres store: the store
  // returns null when no operator row exists, and this flag ships enabled by
  // registry default — only the service applies that default (store row →
  // PostHog rule → registry default).
  return await featureFlagService.isEnabled("release_trace_media_extraction", {
    distinctId: projectId,
    projectId,
  });
}

async function defaultHasContentDropRules(projectId: string): Promise<boolean> {
  // Mirrors applyOtlpSpanContentDrop's kill switch: with enforcement off the
  // drop never runs at the worker, so there is nothing to interlock with.
  if (process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT === "off") return false;
  const policy = await getDataPrivacyPolicyService().getResolvedForProject({
    projectId,
  });
  const { roles, stripToolCalls } = rolesDroppedFromChatArrays(policy);
  return (
    computeDroppedKeys(policy).size > 0 ||
    computeDropMatchers(policy).length > 0 ||
    roles.size > 0 ||
    stripToolCalls
  );
}

/**
 * True when any span or span-event attribute string value carries a media
 * marker. Pure linear scans, no allocation, no I/O — this is the gate that
 * keeps the 99.9% no-media ingestion path at zero added cost.
 */
export function spanCarriesMediaMarkers(span: OtlpSpan): boolean {
  const attrsCarryMarkers = (attributes: OtlpKeyValue[] | undefined) =>
    Array.isArray(attributes) &&
    attributes.some(
      (attr) =>
        typeof attr?.value?.stringValue === "string" &&
        containsMediaMarkers(attr.value.stringValue),
    );

  if (attrsCarryMarkers(span.attributes)) return true;
  for (const event of span.events ?? []) {
    if (attrsCarryMarkers(event.attributes)) return true;
  }
  return false;
}

async function rewriteAttributeList({
  attributes,
  projectId,
  ownerId,
  service,
  refs,
}: {
  attributes: OtlpKeyValue[];
  projectId: string;
  ownerId: string;
  service: StoredObjectsService;
  refs: ExtractedRef[];
}): Promise<OtlpKeyValue[]> {
  let changed = false;
  const out: OtlpKeyValue[] = [];
  for (const attr of attributes) {
    const stringValue = attr?.value?.stringValue;
    if (typeof stringValue === "string" && containsMediaMarkers(stringValue)) {
      const result = await extractInlineMediaFromValue({
        value: stringValue,
        projectId,
        purpose: TRACE_MEDIA_PURPOSE,
        ownerKind: "trace",
        ownerId,
        service,
      });
      if (typeof result.value === "string" && result.value !== stringValue) {
        changed = true;
        refs.push(...result.refs);
        out.push({
          ...attr,
          value: { ...attr.value, stringValue: result.value },
        });
        continue;
      }
    }
    out.push(attr);
  }
  return changed ? out : attributes;
}

/**
 * Externalizes inline media from the span's attribute values, returning the
 * command data with parts rewritten to stored-object references — or the
 * original command data unchanged when there is no media, the flag is off,
 * the project has content-drop rules, or anything fails (fail-open).
 */
export async function maybeExtractSpanMedia({
  data,
  deps,
  logger,
}: {
  data: RecordSpanCommandData;
  deps?: Partial<EdgeMediaExtractionDeps>;
  logger: EdgeMediaExtractionLogger;
}): Promise<RecordSpanCommandData> {
  const span = data.span;
  if (!spanCarriesMediaMarkers(span)) return data;

  const resolved: EdgeMediaExtractionDeps = {
    isEnabled: deps?.isEnabled ?? defaultIsEnabled,
    hasContentDropRules:
      deps?.hasContentDropRules ?? defaultHasContentDropRules,
    createService:
      deps?.createService ??
      ((projectId: string) => createStoredObjectsService({ projectId })),
  };

  const projectId = data.tenantId;
  const traceId = span.traceId as string;
  const spanId = span.spanId as string;

  let stage: "flag_store" | "privacy_probe" | "storage" = "flag_store";
  try {
    if (!(await resolved.isEnabled(projectId))) return data;

    stage = "privacy_probe";
    if (await resolved.hasContentDropRules(projectId)) return data;

    stage = "storage";
    const service = resolved.createService(projectId);
    const refs: ExtractedRef[] = [];

    const attributes = await rewriteAttributeList({
      attributes: span.attributes,
      projectId,
      ownerId: traceId,
      service,
      refs,
    });

    let eventsChanged = false;
    const events = (span.events ?? []).map((event) => event);
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      const rewritten = await rewriteAttributeList({
        attributes: event.attributes,
        projectId,
        ownerId: traceId,
        service,
        refs,
      });
      if (rewritten !== event.attributes) {
        eventsChanged = true;
        events[i] = { ...event, attributes: rewritten };
      }
    }

    if (attributes === span.attributes && !eventsChanged) return data;

    logger.info(
      {
        projectId,
        traceId,
        spanId,
        storedObjectIds: refs.map((ref) => ref.id),
        dedupHits: refs.filter((ref) => ref.isDuplicate).length,
      },
      `span media extraction externalized ${refs.length} stored object(s)`,
    );

    return {
      ...data,
      span: {
        ...span,
        attributes,
        ...(eventsChanged ? { events } : {}),
      },
    };
  } catch (err) {
    getEdgeMediaExtractFailOpenCounter(stage).inc();
    logger.warn(
      {
        projectId,
        traceId,
        spanId,
        reason: stage,
        error: err instanceof Error ? err.message : String(err),
      },
      "Edge media extraction failed — falling back to unmodified command data (fail-open)",
    );
    return data;
  }
}
