import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import { isRecord } from "./canonical-guard.rules";
import { safeStringify } from "./langwatch-structured-value.rules";

const LANGWATCH_RULE_PREFIX = "langwatch";

export function canonicaliseLangWatchMetadata(ctx: ExtractorContext): void {
  canonicaliseMetadataBlob(ctx);
  canonicaliseMetadataSubkeys(ctx);
  canonicaliseParams(ctx);
}

function canonicaliseMetadataBlob(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const metadata =
    attrs.take("metadata") ?? attrs.take("langwatch.metadata") ?? attrs.take("langwatch.trace");
  if (isRecord(metadata)) {
    if (Array.isArray(metadata.labels)) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_LABELS, [...metadata.labels]);
      ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata.labels`);
    }

    const metaUserId = metadata.user_id ?? metadata.userId;
    if (typeof metaUserId === "string" && metaUserId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_USER_ID, metaUserId);
      ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata.user_id`);
    }

    const metaThreadId = metadata.thread_id ?? metadata.threadId;
    if (typeof metaThreadId === "string" && metaThreadId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, metaThreadId);
      ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata.thread_id`);
    }

    const metaCustomerId = metadata.customer_id ?? metadata.customerId;
    if (typeof metaCustomerId === "string" && metaCustomerId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_CUSTOMER_ID, metaCustomerId);
      ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata.customer_id`);
    }

    const RESERVED_METADATA_KEYS = new Set([
      "labels",
      "user_id",
      "userId",
      "thread_id",
      "threadId",
      "customer_id",
      "customerId",
    ]);
    for (const [key, value] of Object.entries(metadata)) {
      if (RESERVED_METADATA_KEYS.has(key)) {
        continue;
      }
      if (value !== null && value !== void 0) {
        ctx.setAttrIfAbsent(
          `metadata.${key}`,
          typeof value === "string" ? value : safeStringify(value),
        );
      }
    }
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata.hoisted`);
  } else if (metadata !== void 0 && metadata !== null) {
    ctx.setAttrIfAbsent(
      "metadata._raw",
      typeof metadata === "string" ? metadata : safeStringify(metadata),
    );
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata._raw`);
  }
}

function canonicaliseMetadataSubkeys(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const METADATA_SUBKEY_PREFIXES = ["langwatch.metadata.", "langwatch.trace."] as const;
  for (const prefix of METADATA_SUBKEY_PREFIXES) {
    for (const { key, value } of attrs.takeByPrefix(prefix)) {
      const bareKey = key.slice(prefix.length);
      if (bareKey && value !== null && value !== void 0) {
        ctx.setAttr(
          `metadata.${bareKey}`,
          typeof value === "string" ? value : safeStringify(value),
        );
      }
    }
  }
}

function canonicaliseParams(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const params = attrs.take(ATTR_KEYS.LANGWATCH_PARAMS);
  if (params !== void 0) {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_PARAMS, params);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:params`);
  }
}
