import { TraceState } from "@opentelemetry/core";
import type { Fixed64 } from "@opentelemetry/otlp-transformer-next/build/esm/common/internal-types";
import {
  ESpanKind,
  type EStatusCode,
} from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import { match } from "ts-pattern";
import type { OtlpAnyValue, OtlpKeyValue, OtlpSpan } from "../schemas/otlp";
import {
  type NormalizedAttributes,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "../schemas/spans";

const TRACE_FLAGS_MASK = 0xff as const; // bits 0–7
const TRACE_FLAGS_IS_REMOTE_MASK = 1 << 8; // bit 8
const TRACE_FLAGS_HAS_IS_REMOTE_MASK = 1 << 9; // bit 9

export type TraceFlagsInfo = {
  sampled: boolean | null; // only meaningful if not null
  remote: boolean | null; // only meaningful if not null
};

export type ParentContext = {
  traceId: string | null;
  spanId: string | null;
  isRemote: boolean | null;
  isSampled: boolean | null;
};

export type TraceStateInfo = {
  version: string | null;
  versionFormat: string | null;
  traceId: string | null;
  spanId: string | null;
};

type AttributeScalar = string | boolean | number | Uint8Array;
type AttributeValue = AttributeScalar | AttributeScalar[];

type FlattenResult = Record<string, AttributeValue>;

const SEP = ".";

const join = (prefix: string, key: string): string =>
  prefix ? `${prefix}${SEP}${key}` : key;

const indexKey = (prefix: string, i: number): string =>
  prefix ? `${prefix}${SEP}${i}` : String(i);

const scalar = (v: OtlpAnyValue): AttributeScalar | undefined => {
  if ("stringValue" in v && typeof v.stringValue === "string") {
    return v.stringValue;
  }
  if (
    "arrayValue" in v &&
    v.arrayValue &&
    Array.isArray(v.arrayValue?.values)
  ) {
    return JSON.stringify(
      v.arrayValue.values.map((item) => scalar(item) ?? item),
    );
  }
  if ("bytesValue" in v && v.bytesValue) {
    if (typeof v.bytesValue === "string") {
      return Buffer.from(v.bytesValue, "base64");
    }
    return v.bytesValue;
  }
  if ("boolValue" in v && v.boolValue !== null) {
    if (typeof v.boolValue === "string") {
      return (v.boolValue as string).toLowerCase() === "true";
    }
    return v.boolValue;
  }
  if ("intValue" in v && v.intValue) {
    if (typeof v.intValue === "string") {
      return parseInt(v.intValue, 10);
    }
    if (
      typeof v.intValue === "object" &&
      v.intValue !== null &&
      "high" in v.intValue &&
      "low" in v.intValue
    ) {
      const { high, low } = v.intValue;

      return Number((BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn));
    }
    return v.intValue;
  }
  if ("doubleValue" in v && v.doubleValue) {
    if (typeof v.doubleValue === "string") {
      return parseFloat(v.doubleValue);
    }
    return v.doubleValue;
  }

  return void 0;
};

const isScalar = (v: OtlpAnyValue): boolean => scalar(v) !== void 0;

const normalizeOtlpId = (id: string | Uint8Array): string => {
  if (id instanceof Uint8Array) {
    return Buffer.from(id).toString("hex");
  }

  return id;
};

const normalizeOtlpSpanIds = (
  span: OtlpSpan,
): { traceId: string; spanId: string } => {
  const traceId = normalizeOtlpId(span.traceId);
  const spanId = normalizeOtlpId(span.spanId);

  return { traceId, spanId };
};

const normalizeOtlpUnixNano = (value: Fixed64): number => {
  if (typeof value === "string") {
    return parseInt(value, 10);
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "object" && "high" in value && "low" in value) {
    const { high, low } = value;

    if (typeof high === "number" && typeof low === "number") {
      const bigIntValue = Number(
        (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn),
      );

      return bigIntValue;
    }
  }

  throw new Error(`Invalid Unix nano value: ${value}`);
};

const normalizeOtlpParentAndTraceContext = (
  parentOtlpSpanId: string | Uint8Array | null | undefined,
  traceState: string | null | undefined,
  spanFlags: number | null | undefined,
): ParentContext => {
  const parsedTraceState = parseTraceState(traceState);
  const parentSpanId = parentOtlpSpanId
    ? normalizeOtlpId(parentOtlpSpanId)
    : null;

  const parsedTraceFlags = parseTraceFlags(spanFlags);

  return {
    spanId: parentSpanId,
    traceId: parsedTraceState.traceId,
    isRemote: parsedTraceFlags.remote,
    isSampled: parsedTraceFlags.sampled,
  };
};

const normalizeOtlpSpanKind = (
  kind: ESpanKind | string,
): NormalizedSpanKind => {
  return match(kind)
    .with(ESpanKind.SPAN_KIND_UNSPECIFIED, () => NormalizedSpanKind.UNSPECIFIED)
    .with("SPAN_KIND_UNSPECIFIED", () => NormalizedSpanKind.UNSPECIFIED)
    .with(ESpanKind.SPAN_KIND_INTERNAL, () => NormalizedSpanKind.INTERNAL)
    .with("SPAN_KIND_INTERNAL", () => NormalizedSpanKind.INTERNAL)
    .with(ESpanKind.SPAN_KIND_SERVER, () => NormalizedSpanKind.SERVER)
    .with("SPAN_KIND_SERVER", () => NormalizedSpanKind.SERVER)
    .with(ESpanKind.SPAN_KIND_CLIENT, () => NormalizedSpanKind.CLIENT)
    .with("SPAN_KIND_CLIENT", () => NormalizedSpanKind.CLIENT)
    .with(ESpanKind.SPAN_KIND_PRODUCER, () => NormalizedSpanKind.PRODUCER)
    .with("SPAN_KIND_PRODUCER", () => NormalizedSpanKind.PRODUCER)
    .with(ESpanKind.SPAN_KIND_CONSUMER, () => NormalizedSpanKind.CONSUMER)
    .with("SPAN_KIND_CONSUMER", () => NormalizedSpanKind.CONSUMER)
    .otherwise(() => NormalizedSpanKind.UNSPECIFIED);
};

const normalizeOtlpStatusCode = (
  statusCode: EStatusCode | string | undefined | null,
): NormalizedStatusCode => {
  return match(statusCode)
    .with(0, () => NormalizedStatusCode.UNSET)
    .with("STATUS_CODE_UNSET", () => NormalizedStatusCode.UNSET)
    .with(1, () => NormalizedStatusCode.OK)
    .with("STATUS_CODE_OK", () => NormalizedStatusCode.OK)
    .with(2, () => NormalizedStatusCode.ERROR)
    .with("STATUS_CODE_ERROR", () => NormalizedStatusCode.ERROR)
    .otherwise(() => NormalizedStatusCode.UNSET);
};

const normalizeOtlpAnyValue = (
  root: OtlpAnyValue,
  rootKey?: string,
): FlattenResult => {
  const out: FlattenResult = {};

  const set = (k: string | undefined | null, v: AttributeValue) => {
    if (!k) return;
    out[k] = v; // last write wins
  };

  const walk = (v: OtlpAnyValue, prefix: string) => {
    const s = scalar(v);
    if (s !== void 0) {
      set(prefix, s);
      return;
    }

    if ("kvlistValue" in v && v.kvlistValue) {
      for (const { key, value } of v.kvlistValue.values)
        walk(value, join(prefix, key));

      return;
    }

    if ("arrayValue" in v && v.arrayValue) {
      const vsRaw = v.arrayValue.values ?? [];
      const vs = vsRaw.filter(Boolean);

      if (vs.every(isScalar)) {
        set(
          prefix,
          vs
            .map((x) => scalar(x)!)
            .filter((x): x is AttributeScalar => x !== void 0),
        );
        return;
      }

      for (const [i, child] of vs.entries()) {
        walk(child, indexKey(prefix, i));
      }

      return;
    }

    // empty {} or unknown -> ignore
  };

  // Scalar root has no natural key, so only keep it if rootKey provided.
  const rootScalar = scalar(root);
  if (rootScalar !== void 0) {
    if (rootKey) set(rootKey, rootScalar);
    return out;
  }

  walk(root, rootKey ? rootKey : "");
  return out;
};

const normalizeOtlpAttributeValue = (
  v: AttributeValue,
): Exclude<NormalizedAttributes[string], undefined> | undefined => {
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");

  if (Array.isArray(v)) {
    const out: Array<string | boolean | number | bigint> = [];

    for (const item of v) {
      if (item instanceof Uint8Array) {
        out.push(Buffer.from(item).toString("hex"));
        continue;
      }

      if (
        typeof item === "string" ||
        typeof item === "boolean" ||
        typeof item === "number" ||
        typeof item === "bigint"
      ) {
        out.push(item);
      }
    }

    return out;
  }

  if (
    typeof v === "string" ||
    typeof v === "boolean" ||
    typeof v === "number" ||
    typeof v === "bigint"
  ) {
    return v;
  }

  return void 0;
};

// Regex to match keys with numeric array indices: prefix.N.remainder
const INDEXED_KEY_REGEX = /^(.+?)\.(\d+)\.(.+)$/;

type ArrayPatternMap = Map<
  string,
  Map<number, Map<string, unknown>>
>;

/**
 * Scans all keys to find potential flattened array patterns.
 * Groups them by prefix, index, and relative path.
 *
 * For input like:
 *   "llm.input_messages.0.message.content" => "hello"
 *   "llm.input_messages.0.message.role" => "user"
 *   "llm.input_messages.1.message.content" => "hi"
 *   "llm.input_messages.1.message.role" => "assistant"
 *
 * Returns a Map where:
 *   key: "llm.input_messages"
 *   value: Map {
 *     0 => Map { "message.content" => "hello", "message.role" => "user" },
 *     1 => Map { "message.content" => "hi", "message.role" => "assistant" }
 *   }
 */
const detectArrayPatterns = (
  attrs: NormalizedAttributes,
): { patterns: ArrayPatternMap; matchedKeys: Set<string> } => {
  const patterns: ArrayPatternMap = new Map();
  const matchedKeys = new Set<string>();

  for (const [key, value] of Object.entries(attrs)) {
    const match = INDEXED_KEY_REGEX.exec(key);
    if (!match || match.length !== 4) continue;

    const [, prefix, indexStr, remainder] = match;
    if (!prefix || !indexStr || !remainder) continue;

    const index = parseInt(indexStr, 10);
    if (!patterns.has(prefix)) {
      patterns.set(prefix, new Map());
    }

    const indexMap = patterns.get(prefix)!;
    if (!indexMap.has(index)) {
      indexMap.set(index, new Map());
    }

    indexMap.get(index)!.set(remainder, value);
    matchedKeys.add(key);
  }

  return { patterns, matchedKeys };
};

/**
 * Validates that a detected array pattern has:
 * 1. Consecutive indices starting from 0
 * 2. Same set of relative keys across all items
 */
const isValidArrayPattern = (
  indexMap: Map<number, Map<string, NormalizedAttributes[string]>>,
): boolean => {
  const indices = Array.from(indexMap.keys()).sort((a, b) => a - b);

  // Must start at 0
  if (indices.length === 0 || indices[0] !== 0) return false;

  // Must be consecutive
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) return false;
  }

  // All items must have the same set of relative keys
  const keySignatures = new Set<string>();
  for (const [, relativeMap] of indexMap) {
    const keys = Array.from(relativeMap.keys()).sort().join("\0");
    keySignatures.add(keys);
  }

  // If there's more than one unique key signature, shapes are inconsistent
  return keySignatures.size === 1;
};

/**
 * Reconstructs a nested object from flattened key-value pairs.
 *
 * For input:
 *   Map { "message.content" => "hello", "message.role" => "user" }
 *
 * Returns:
 *   { message: { content: "hello", role: "user" } }
 */
const unflattenObject = (
  flatMap: Map<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [path, value] of flatMap) {
    const parts = path.split(SEP);
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1]!;
    current[lastPart] = value;
  }

  return result;
};

/**
 * Post-processes normalized attributes to reconstruct flattened arrays.
 *
 * Converts patterns like:
 *   "llm.input_messages.0.message.content" => "hello"
 *   "llm.input_messages.0.message.role" => "user"
 *   "llm.input_messages.1.message.content" => "hi"
 *
 * Into:
 *   "llm.input_messages" => [{message:{content:"hello",role:"user"}},{message:{content:"hi"}}]
 */
const reconstructFlattenedArrays = (
  attrs: NormalizedAttributes,
): NormalizedAttributes => {
  const { patterns, matchedKeys } = detectArrayPatterns(attrs);

  // If no patterns found, return original
  if (patterns.size === 0) return attrs;

  const result: NormalizedAttributes = {};
  const processedPrefixes = new Set<string>();

  // Copy over non-matched keys
  for (const [key, value] of Object.entries(attrs)) {
    if (!matchedKeys.has(key)) {
      result[key] = value;
    }
  }

  // Process each detected array pattern
  for (const [prefix, indexMap] of patterns) {
    if (!isValidArrayPattern(indexMap)) {
      // Invalid pattern - copy original keys back
      for (const [index, relativeMap] of indexMap) {
        for (const [relativePath, value] of relativeMap) {
          result[`${prefix}${SEP}${index}${SEP}${relativePath}`] = value;
        }
      }
      continue;
    }

    processedPrefixes.add(prefix);

    // Build the array
    const indices = Array.from(indexMap.keys()).sort((a, b) => a - b);
    const arrayItems: Record<string, unknown>[] = [];

    for (const index of indices) {
      const relativeMap = indexMap.get(index)!;
      const item = unflattenObject(relativeMap);
      arrayItems.push(item);
    }

    // Store as real array (not JSON string)
    result[prefix] = arrayItems;
  }

  return result;
};

/**
 * Maximum string size to attempt synchronous JSON parsing.
 * Strings larger than this are left as-is to avoid blocking the event loop.
 */
const MAX_JSON_PARSE_SIZE = 2_000_000;

/**
 * Parses string values that look like JSON into their parsed form.
 * Scalars and already-parsed values pass through unchanged.
 *
 * Fast-path: only attempts parse if the trimmed string starts with `{` or `[`.
 */
const parseJsonStringValues = (
  attrs: NormalizedAttributes,
): NormalizedAttributes => {
  const result: NormalizedAttributes = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") {
      result[key] = value;
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > MAX_JSON_PARSE_SIZE) {
      result[key] = value;
      continue;
    }

    const looksJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));

    if (!looksJson) {
      result[key] = value;
      continue;
    }

    try {
      result[key] = JSON.parse(trimmed);
    } catch {
      result[key] = value;
    }
  }

  return result;
};

const normalizeOtlpAttributes = (
  attributes: OtlpKeyValue[],
): NormalizedAttributes => {
  const normalizedAttributes: NormalizedAttributes = {};

  for (const attr of attributes ?? []) {
    if (!attr?.key || !attr.value) continue;

    const flattened = normalizeOtlpAnyValue(attr.value, attr.key);

    for (const [k, v] of Object.entries(flattened)) {
      const nv = normalizeOtlpAttributeValue(v);
      if (nv !== void 0) normalizedAttributes[k] = nv;
    }
  }

  // Post-process: reconstruct flattened arrays, then parse JSON string values
  const reconstructed = reconstructFlattenedArrays(normalizedAttributes);
  return parseJsonStringValues(reconstructed);
};

const convertUnixNanoToUnixMs = (unixNano: number): number => {
  return Math.round(unixNano / 1_000_000);
};

/**
 * Parses the trace flags from the span flags.
 *
 * Reference: https://www.w3.org/TR/trace-context-2/#trace-flags
 * @param spanFlags - The span flags.
 * @returns The trace flags info.
 */
const parseTraceFlags = (
  spanFlags: number | undefined | null,
): TraceFlagsInfo => {
  if (spanFlags === void 0 || spanFlags === null) {
    return {
      sampled: null,
      remote: null,
    };
  }

  const safeSpanFlags = spanFlags >>> 0; // force to uint32
  const hasRemoteFlag = (safeSpanFlags & TRACE_FLAGS_IS_REMOTE_MASK) !== 0;
  const remoteFlag = hasRemoteFlag
    ? safeSpanFlags & TRACE_FLAGS_HAS_IS_REMOTE_MASK
    : void 0;

  return {
    sampled: (safeSpanFlags & TRACE_FLAGS_MASK) !== 0,
    remote: hasRemoteFlag ? remoteFlag !== 0 : null,
  };
};

/**
 * Parses the trace state from the trace state string.
 *
 * We reply on the TraceState class from the @opentelemetry/core package to parse the
 * trace state, as it is the most complete and accurate implementation of the trace state.
 *
 * And I don't want to deal with all the messy edge cases.
 *
 * Reference: https://www.w3.org/TR/trace-context/#tracestate-header
 * @param traceState - The trace state string.
 * @returns The trace state info.
 */
const parseTraceState = (
  traceState: string | null | undefined,
): TraceStateInfo => {
  if (traceState === void 0 || traceState === null) {
    return {
      version: null,
      versionFormat: null,
      traceId: null,
      spanId: null,
    };
  }

  const parsedTraceState = new TraceState(traceState);

  return {
    version: parsedTraceState.get("version") ?? null,
    versionFormat: parsedTraceState.get("versionFormat") ?? null,
    traceId: parsedTraceState.get("traceId") ?? null,
    spanId: parsedTraceState.get("spanId") ?? null,
  };
};

export const TraceRequestUtils = {
  normalizeOtlpId,
  normalizeOtlpSpanIds,
  normalizeOtlpUnixNano,
  normalizeOtlpParentAndTraceContext,
  normalizeOtlpSpanKind,
  normalizeOtlpStatusCode,
  normalizeOtlpAnyValue,
  normalizeOtlpAttributes,
  convertUnixNanoToUnixMs,
  parseTraceFlags,
  parseTraceState,
};
