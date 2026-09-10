import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../services/canonicalisers/canonical-attributes.service.ts";
import { isRecord } from "./canonical-guard.rules.ts";
import { safeStringify } from "./langwatch-structured-value.rules.ts";

const LANGWATCH_RULE_PREFIX = "langwatch";

export function canonicaliseLangWatchMetadata(ctx: ExtractorContext): void {
  canonicaliseMetadataBlob(ctx);
  canonicaliseMetadataSubkeys(ctx);
  canonicaliseParams(ctx);
}

const RESERVED_METADATA_KEYS: Readonly<Record<string, true>> = {
  labels: true,
  user_id: true,
  userId: true,
  thread_id: true,
  threadId: true,
  customer_id: true,
  customerId: true,
};

/** The reserved metadata keys, under both spellings, and the canonical attribute each becomes. */
const RESERVED_METADATA_FIELDS = [
  { attribute: ATTR_KEYS.LANGWATCH_USER_ID, keys: ["user_id", "userId"], rule: "metadata.user_id" },
  {
    attribute: ATTR_KEYS.GEN_AI_CONVERSATION_ID,
    keys: ["thread_id", "threadId"],
    rule: "metadata.thread_id",
  },
  {
    attribute: ATTR_KEYS.LANGWATCH_CUSTOMER_ID,
    keys: ["customer_id", "customerId"],
    rule: "metadata.customer_id",
  },
] as const;

function hoistReservedMetadata(ctx: ExtractorContext, metadata: Record<string, unknown>): void {
  if (Array.isArray(metadata.labels)) {
    ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_LABELS, [...metadata.labels]);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata.labels`);
  }

  for (const field of RESERVED_METADATA_FIELDS) {
    const value = metadata[field.keys[0]] ?? metadata[field.keys[1]];
    if (typeof value !== "string" || value.length === 0) continue;

    ctx.setAttrIfAbsent(field.attribute, value);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:${field.rule}`);
  }
}

/** Every non-reserved metadata key travels as its own `metadata.<key>` attribute. */
function hoistCustomMetadata(ctx: ExtractorContext, metadata: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (RESERVED_METADATA_KEYS[key] === true) continue;
    if (value === null || value === void 0) continue;

    ctx.setAttrIfAbsent(
      `metadata.${key}`,
      typeof value === "string" ? value : safeStringify(value),
    );
  }
  ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata.hoisted`);
}

function canonicaliseMetadataBlob(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const metadata =
    attrs.take("metadata") ?? attrs.take("langwatch.metadata") ?? attrs.take("langwatch.trace");

  if (isRecord(metadata)) {
    hoistReservedMetadata(ctx, metadata);
    hoistCustomMetadata(ctx, metadata);
    return;
  }

  if (metadata === void 0 || metadata === null) return;

  ctx.setAttrIfAbsent(
    "metadata._raw",
    typeof metadata === "string" ? metadata : safeStringify(metadata),
  );
  ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metadata._raw`);
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
