import { createLogger } from "@langwatch/observability";
import type { DataPrivacyService } from "@langwatch/data-privacy-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { matchesAnyAttributePattern } from "./attributePatternMatcher";
import type { ResolvedDataPrivacy } from "./dataPrivacy.types";
import {
  CHAT_ARRAY_KEYS,
  computeDropMatchers,
  computeDroppedKeys,
  DROPPED_ATTRIBUTES_MARKER_MAX_KEYS,
  droppedCategories,
  PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR,
  PRIVACY_DROPPED_MARKER_ATTR,
  rolesDroppedFromChatArrays,
  stripRolesFromChatArrayJson,
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
  const stripAttrs = (attributes: OtlpSpan["attributes"]): OtlpSpan["attributes"] =>
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

  // Role-based categories (system, tools) also live inside the captured
  // input/output conversation, so strip those roles from every surviving
  // chat-message array. Done before canonicalization can re-derive
  // gen_ai.system_instructions from a system turn that was left behind.
  const { roles: droppedRoles, stripToolCalls } = rolesDroppedFromChatArrays(policy);
  const stripRoles = (attributes: OtlpSpan["attributes"]): OtlpSpan["attributes"] => {
    if (droppedRoles.size === 0 && !stripToolCalls) return attributes;
    return attributes.map((attr) => {
      const stringValue = attr.value?.stringValue;
      if (!CHAT_ARRAY_KEYS.has(attr.key) || typeof stringValue !== "string") {
        return attr;
      }
      const result = stripRolesFromChatArrayJson(stringValue, droppedRoles, stripToolCalls);
      if (!result) return attr;
      droppedCount += result.removed;
      return { ...attr, value: { ...attr.value, stringValue: result.json } };
    });
  };

  span.attributes = stripRoles(stripAttrs(span.attributes));
  for (const event of span.events) {
    event.attributes = stripRoles(stripAttrs(event.attributes));
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

/** Process-composed variant used by Trace processing; it has no global policy dependency. */
export async function applyOtlpSpanContentDropWithPolicy({
  span,
  projectId,
  dataPrivacy,
  nativePolicyEnforced,
}: {
  span: OtlpSpan;
  projectId: string;
  dataPrivacy: DataPrivacyService;
  nativePolicyEnforced: boolean;
}): Promise<SpanContentDropResult> {
  if (!nativePolicyEnforced) return { ...EMPTY_DROP_RESULT };
  try {
    const policy = await dataPrivacy.getResolvedForProject({ projectId });
    return stripOtlpSpanContent({ span, policy });
  } catch (error) {
    logger.error(
      { error, projectId },
      "data-privacy content drop skipped: policy resolution or strip failed; keeping span content intact (fail-open, still subject to read-time visibility)",
    );
    return { ...EMPTY_DROP_RESULT };
  }
}
