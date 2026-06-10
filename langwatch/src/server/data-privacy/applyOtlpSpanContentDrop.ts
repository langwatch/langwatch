import type { OtlpSpan } from "../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type { ResolvedDataPrivacy } from "./dataPrivacy.types";
import { getDataPrivacyPolicyService } from "./dataPrivacyPolicy.service";
import {
  computeDroppedKeys,
  droppedCategories,
  PRIVACY_DROPPED_MARKER_ATTR,
} from "./dropKeyCatalog";

export interface SpanContentDropResult {
  /** How many attribute entries were removed across the span and its events. */
  droppedCount: number;
  /** The content categories the policy dropped (for the marker / observability). */
  droppedCategories: string[];
}

/**
 * Strip every dropped content key from an OTLP span IN PLACE for a resolved
 * policy: each `drop` category's key-set plus the policy's custom drop-keys, on
 * the span attributes and every event's attributes. Metadata keys (tokens,
 * cost, model, latency, ids, names, status) are never in a droppable key-set,
 * so they always survive. When any category is dropped a marker attribute is
 * stamped listing them so the trace view can explain the absence.
 *
 * Pure given the policy (no I/O) so it can be unit-tested directly.
 */
export function stripOtlpSpanContent({
  span,
  policy,
}: {
  span: OtlpSpan;
  policy: ResolvedDataPrivacy;
}): SpanContentDropResult {
  const droppedKeys = computeDroppedKeys(policy);
  if (droppedKeys.size === 0) {
    return { droppedCount: 0, droppedCategories: [] };
  }

  let droppedCount = 0;
  const stripAttrs = (
    attributes: OtlpSpan["attributes"],
  ): OtlpSpan["attributes"] =>
    attributes.filter((attr) => {
      if (droppedKeys.has(attr.key)) {
        droppedCount++;
        return false;
      }
      return true;
    });

  span.attributes = stripAttrs(span.attributes);
  for (const event of span.events) {
    event.attributes = stripAttrs(event.attributes);
  }

  const categories = droppedCategories(policy);
  if (categories.length > 0) {
    span.attributes = span.attributes.filter(
      (attr) => attr.key !== PRIVACY_DROPPED_MARKER_ATTR,
    );
    span.attributes.push({
      key: PRIVACY_DROPPED_MARKER_ATTR,
      value: { stringValue: categories.join(",") },
    });
  }

  return { droppedCount, droppedCategories: categories };
}

/**
 * Resolve the project's effective privacy policy and drop its configured
 * content from the OTLP span IN PLACE, before the span becomes a
 * SpanReceivedEvent. Running at this single command choke point (rather than in
 * the storage projection) means every downstream consumer of the event — the
 * span store AND the trace-summary fold that derives ComputedInput/Output —
 * sees the already-dropped span, so dropped content never lands anywhere.
 *
 * Gated by the LANGWATCH_DATA_PRIVACY_ENFORCEMENT=off kill switch. Resolution
 * failures fail open (the span is kept intact) rather than dropping the event.
 */
export async function applyOtlpSpanContentDrop({
  span,
  projectId,
}: {
  span: OtlpSpan;
  projectId: string;
}): Promise<SpanContentDropResult> {
  if (process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT === "off") {
    return { droppedCount: 0, droppedCategories: [] };
  }
  let policy: ResolvedDataPrivacy;
  try {
    policy = await getDataPrivacyPolicyService().getResolvedForProject({
      projectId,
    });
  } catch {
    return { droppedCount: 0, droppedCategories: [] };
  }
  return stripOtlpSpanContent({ span, policy });
}
