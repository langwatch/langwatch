import { createLogger } from "../../utils/logger/server";
import type { OtlpSpan } from "../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { matchesAnyAttributePattern } from "./attributePatternMatcher";
import type { ResolvedDataPrivacy } from "./dataPrivacy.types";
import { getDataPrivacyPolicyService } from "./dataPrivacyPolicy.service";
import {
  computeDropMatchers,
  computeDroppedKeys,
  DROPPED_ATTRIBUTES_MARKER_MAX_KEYS,
  droppedCategories,
  PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR,
  PRIVACY_DROPPED_MARKER_ATTR,
} from "./dropKeyCatalog";

const logger = createLogger("langwatch:data-privacy:content-drop");

export interface SpanContentDropResult {
  /** How many attribute entries were removed across the span and its events. */
  droppedCount: number;
  /** The content categories the policy dropped (for the marker / observability). */
  droppedCategories: string[];
  /** Attribute keys removed by custom attribute rules (names only, deduped). */
  droppedAttributeKeys: string[];
}

const EMPTY_DROP_RESULT: SpanContentDropResult = {
  droppedCount: 0,
  droppedCategories: [],
  droppedAttributeKeys: [],
};

/**
 * Strip every dropped content key from an OTLP span IN PLACE for a resolved
 * policy: each `drop` category's key-set plus the policy's custom attribute
 * rules (exact keys or `*` wildcards), on the span attributes and every event's
 * attributes. Metadata keys (tokens, cost, model, latency, ids, names, status)
 * are never in a droppable key-set, so they always survive. When a category is
 * dropped a marker attribute is stamped listing the categories; when custom
 * attribute rules drop keys a second marker lists the dropped key NAMES (never
 * the values) so the trace view can explain the absence.
 *
 * Deterministic and free of I/O: it mutates the passed `span` in place rather
 * than returning a copy, so it can be unit-tested directly without a database.
 */
export function stripOtlpSpanContent({
  span,
  policy,
}: {
  span: OtlpSpan;
  policy: ResolvedDataPrivacy;
}): SpanContentDropResult {
  const droppedKeys = computeDroppedKeys(policy);
  const dropMatchers = computeDropMatchers(policy);
  if (droppedKeys.size === 0 && dropMatchers.length === 0) {
    return { ...EMPTY_DROP_RESULT };
  }

  let droppedCount = 0;
  const droppedAttributeKeys = new Set<string>();
  const stripAttrs = (
    attributes: OtlpSpan["attributes"],
  ): OtlpSpan["attributes"] =>
    attributes.filter((attr) => {
      if (droppedKeys.has(attr.key)) {
        droppedCount++;
        return false;
      }
      if (matchesAnyAttributePattern(attr.key, dropMatchers)) {
        droppedCount++;
        droppedAttributeKeys.add(attr.key);
        return false;
      }
      return true;
    });

  span.attributes = stripAttrs(span.attributes);
  for (const event of span.events) {
    event.attributes = stripAttrs(event.attributes);
  }

  const stampMarker = (key: string, value: string) => {
    span.attributes = span.attributes.filter((attr) => attr.key !== key);
    span.attributes.push({ key, value: { stringValue: value } });
  };

  const categories = droppedCategories(policy);
  if (categories.length > 0) {
    stampMarker(PRIVACY_DROPPED_MARKER_ATTR, categories.join(","));
  }
  const droppedKeyList = [...droppedAttributeKeys];
  if (droppedKeyList.length > 0) {
    stampMarker(
      PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR,
      droppedKeyList.slice(0, DROPPED_ATTRIBUTES_MARKER_MAX_KEYS).join(","),
    );
  }

  return {
    droppedCount,
    droppedCategories: categories,
    droppedAttributeKeys: droppedKeyList,
  };
}

/**
 * Resolve the project's effective privacy policy and drop its configured
 * content from the OTLP span IN PLACE, before the span becomes a
 * SpanReceivedEvent. Running at this single command choke point (rather than in
 * the storage projection) means every downstream consumer of the event — the
 * span store AND the trace-summary fold that derives ComputedInput/Output —
 * sees the already-dropped span, so dropped content never lands anywhere.
 *
 * Gated by the LANGWATCH_DATA_PRIVACY_ENFORCEMENT=off kill switch. Any failure
 * (policy resolution or the strip itself) fails open: the span is kept intact
 * rather than dropping the event, because dropping on a transient error would
 * be permanent content loss. The kept content is still subject to read-time
 * visibility, which fails closed. The failure is logged so a policy-resolution
 * outage is visible rather than silently skipping enforcement.
 */
export async function applyOtlpSpanContentDrop({
  span,
  projectId,
}: {
  span: OtlpSpan;
  projectId: string;
}): Promise<SpanContentDropResult> {
  if (process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT === "off") {
    return { ...EMPTY_DROP_RESULT };
  }
  try {
    const policy: ResolvedDataPrivacy =
      await getDataPrivacyPolicyService().getResolvedForProject({ projectId });
    return stripOtlpSpanContent({ span, policy });
  } catch (error) {
    logger.error(
      { error, projectId },
      "data-privacy content drop skipped: policy resolution or strip failed; keeping span content intact (fail-open, still subject to read-time visibility)",
    );
    return { ...EMPTY_DROP_RESULT };
  }
}
