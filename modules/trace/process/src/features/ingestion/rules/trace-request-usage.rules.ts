import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import {
  ATTR_KEYS,
  CLAUDE_PLATFORM_SPAN_NAMES,
  isClaudePlatformScope,
} from "@langwatch/span-normalisation";

const CLAUDE_REQUEST_RECORD_PREFIX = "anthropic.request:";

/** How a span's usage counts: on its own, or once per billed request it shares with others. */
export type SpanUsageCounting = { kind: "per-span" } | { kind: "per-request"; recordId: string };

/**
 * The Claude SDK's CLIENT span and the Claude API's SERVER span for a Messages request both
 * carry its `anthropic.request.id`, so they share one usage record; each attempt of a retried
 * request has its own id.
 */
export function usageCountingOf({
  span,
  scopeName,
}: {
  span: OtlpSpan;
  scopeName: string | null | undefined;
}): SpanUsageCounting {
  if (
    span.name !== CLAUDE_PLATFORM_SPAN_NAMES.MESSAGES_CREATE ||
    !isClaudePlatformScope(scopeName)
  ) {
    return { kind: "per-span" };
  }

  const requestId = span.attributes.find(
    (attribute) => attribute.key === ATTR_KEYS.ANTHROPIC_REQUEST_ID,
  )?.value.stringValue;

  return typeof requestId === "string" && requestId.length > 0
    ? { kind: "per-request", recordId: `${CLAUDE_REQUEST_RECORD_PREFIX}${requestId}` }
    : { kind: "per-span" };
}

/** The span marked so its usage stays out of every total: another span already counts it. */
export function withUsageCountedElsewhere(span: OtlpSpan): OtlpSpan {
  const attributes = span.attributes.filter(
    (attribute) => attribute.key !== ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION,
  );
  attributes.push({
    key: ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION,
    value: { stringValue: "true" },
  });

  return { ...span, attributes };
}
