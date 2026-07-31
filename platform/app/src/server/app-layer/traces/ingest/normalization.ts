import { TraceState } from "@opentelemetry/core";
import type { Fixed64 } from "@opentelemetry/otlp-transformer-next/build/esm/common/internal-types";
import {
  ESpanKind,
  type EStatusCode,
} from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import { match } from "ts-pattern";
import { safeUnflatten } from "~/utils/safeUnflatten";
import {
  type NormalizedAttributes,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "./normalizedSpan";
import type { OtlpAnyValue, OtlpKeyValue, OtlpSpan } from "./otlp";

/** OTLP wire values → the normalized span's hex ids, unix-ms times and flat attribute map. */

const TRACE_FLAGS_MASK = 0xff as const; // bits 0–7
const TRACE_FLAGS_IS_REMOTE_MASK = 1 << 8; // bit 8
const TRACE_FLAGS_HAS_IS_REMOTE_MASK = 1 << 9; // bit 9

interface TraceFlagsInfo {
  sampled: boolean | null;
  remote: boolean | null;
}

interface ParentContext {
  traceId: string | null;
  spanId: string | null;
  isRemote: boolean | null;
  isSampled: boolean | null;
}

interface TraceStateInfo {
  version: string | null;
  versionFormat: string | null;
  traceId: string | null;
  spanId: string | null;
}

type AttributeScalar = string | boolean | number | Uint8Array;
type AttributeValue = AttributeScalar | AttributeScalar[];

type FlattenResult = Record<string, AttributeValue>;

const SEP = ".";

const join = (prefix: string, key: string): string =>
  prefix ? `${prefix}${SEP}${key}` : key;

const indexKey = (prefix: string, i: number): string =>
  prefix ? `${prefix}${SEP}${i}` : String(i);

/**
 * Every branch guards on presence (`!= null`), never truthiness: 0, 0.0, false
 * and "" are reported values, and a truthiness guard would make them
 * indistinguishable downstream from an attribute that was never reported.
 */
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
  if ("bytesValue" in v && v.bytesValue != null) {
    if (typeof v.bytesValue === "string") {
      return Buffer.from(v.bytesValue, "base64");
    }
    return v.bytesValue;
  }
  if ("boolValue" in v && v.boolValue != null) {
    if (typeof v.boolValue === "string") {
      return (v.boolValue as string).toLowerCase() === "true";
    }
    return v.boolValue;
  }
  if ("intValue" in v && v.intValue != null) {
    if (typeof v.intValue === "string") {
      const parsed = parseInt(v.intValue, 10);
      return Number.isNaN(parsed) ? void 0 : parsed;
    }
    if (
      typeof v.intValue === "object" &&
      "high" in v.intValue &&
      "low" in v.intValue
    ) {
      const { high, low } = v.intValue;
      return Number((BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn));
    }
    return v.intValue;
  }
  if ("doubleValue" in v && v.doubleValue != null) {
    if (typeof v.doubleValue === "string") {
      const parsed = parseFloat(v.doubleValue);
      return Number.isNaN(parsed) ? void 0 : parsed;
    }
    return v.doubleValue;
  }

  return void 0;
};

const isScalar = (v: OtlpAnyValue): boolean => scalar(v) !== void 0;

export function normalizeOtlpId(id: string | Uint8Array): string {
  if (id instanceof Uint8Array) {
    return Buffer.from(id).toString("hex");
  }
  return id;
}

export function normalizeOtlpSpanIds(span: OtlpSpan): {
  traceId: string;
  spanId: string;
} {
  return {
    traceId: normalizeOtlpId(span.traceId),
    spanId: normalizeOtlpId(span.spanId),
  };
}

export function normalizeOtlpUnixNano(value: Fixed64): number {
  if (typeof value === "string") {
    return parseInt(value, 10);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "object" && "high" in value && "low" in value) {
    const { high, low } = value;
    if (typeof high === "number" && typeof low === "number") {
      return Number((BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn));
    }
  }
  throw new Error(`Invalid Unix nano value: ${value}`);
}

export function convertUnixNanoToUnixMs(unixNano: number): number {
  return Math.round(unixNano / 1_000_000);
}

export function normalizeOtlpParentAndTraceContext(
  parentOtlpSpanId: string | Uint8Array | null | undefined,
  traceState: string | null | undefined,
  spanFlags: number | null | undefined,
): ParentContext {
  const parsedTraceState = parseTraceState(traceState);
  const parsedTraceFlags = parseTraceFlags(spanFlags);

  return {
    spanId: parentOtlpSpanId ? normalizeOtlpId(parentOtlpSpanId) : null,
    traceId: parsedTraceState.traceId,
    isRemote: parsedTraceFlags.remote,
    isSampled: parsedTraceFlags.sampled,
  };
}

export function normalizeOtlpSpanKind(
  kind: ESpanKind | string,
): NormalizedSpanKind {
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
}

export function normalizeOtlpStatusCode(
  statusCode: EStatusCode | string | undefined | null,
): NormalizedStatusCode {
  return match(statusCode)
    .with(0, () => NormalizedStatusCode.UNSET)
    .with("STATUS_CODE_UNSET", () => NormalizedStatusCode.UNSET)
    .with(1, () => NormalizedStatusCode.OK)
    .with("STATUS_CODE_OK", () => NormalizedStatusCode.OK)
    .with(2, () => NormalizedStatusCode.ERROR)
    .with("STATUS_CODE_ERROR", () => NormalizedStatusCode.ERROR)
    .otherwise(() => NormalizedStatusCode.UNSET);
}

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
      for (const { key, value } of v.kvlistValue.values) {
        walk(value, join(prefix, key));
      }
      return;
    }

    if ("arrayValue" in v && v.arrayValue) {
      const vs = (v.arrayValue.values ?? []).filter(Boolean);

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
    }

    // empty {} or unknown -> ignore
  };

  // A scalar root has no natural key, so only keep it if rootKey is provided.
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

/** Matches a flattened array element key: `prefix.N.remainder`. */
const INDEXED_KEY_REGEX = /^(.+?)\.(\d+)\.(.+)$/;

type ArrayPatternMap = Map<string, Map<number, Map<string, unknown>>>;

const detectArrayPatterns = (
  attrs: NormalizedAttributes,
): { patterns: ArrayPatternMap; matchedKeys: Set<string> } => {
  const patterns: ArrayPatternMap = new Map();
  const matchedKeys = new Set<string>();

  for (const [key, value] of Object.entries(attrs)) {
    const matched = INDEXED_KEY_REGEX.exec(key);
    if (matched?.length !== 4) continue;

    const [, prefix, indexStr, remainder] = matched;
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

/** Indices must run consecutively from 0 and every item must carry the same keys. */
const isValidArrayPattern = (
  indexMap: Map<number, Map<string, unknown>>,
): boolean => {
  const indices = Array.from(indexMap.keys()).sort((a, b) => a - b);

  if (indices.length === 0 || indices[0] !== 0) return false;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) return false;
  }

  const keySignatures = new Set<string>();
  for (const [, relativeMap] of indexMap) {
    keySignatures.add(Array.from(relativeMap.keys()).sort().join("\0"));
  }

  return keySignatures.size === 1;
};

const unflattenObject = (
  flatMap: Map<string, unknown>,
): Record<string, unknown> => {
  const record: Record<string, unknown> = Object.create(null);
  for (const [k, v] of flatMap) {
    record[k] = v;
  }
  return safeUnflatten(record);
};

/**
 * `llm.input_messages.0.message.role` + `…0.message.content` + `…1.…` become
 * one `llm.input_messages` array of objects.
 */
const reconstructFlattenedArrays = (
  attrs: NormalizedAttributes,
): NormalizedAttributes => {
  const { patterns, matchedKeys } = detectArrayPatterns(attrs);
  if (patterns.size === 0) return attrs;

  const result: NormalizedAttributes = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (!matchedKeys.has(key)) {
      result[key] = value;
    }
  }

  for (const [prefix, indexMap] of patterns) {
    if (!isValidArrayPattern(indexMap)) {
      for (const [index, relativeMap] of indexMap) {
        for (const [relativePath, value] of relativeMap) {
          result[`${prefix}${SEP}${index}${SEP}${relativePath}`] = value;
        }
      }
      continue;
    }

    const indices = Array.from(indexMap.keys()).sort((a, b) => a - b);
    const arrayItems: Record<string, unknown>[] = [];
    for (const index of indices) {
      arrayItems.push(unflattenObject(indexMap.get(index)!));
    }
    result[prefix] = arrayItems;
  }

  return result;
};

/** Beyond this, a synchronous JSON.parse would block the event loop. */
const MAX_JSON_PARSE_SIZE = 2_000_000;

/**
 * PII redaction substitutes `<PII_TYPE>` tokens, which lands `\<` or `\>` in a
 * JSON string value and makes the whole document unparseable.
 */
function sanitizeInvalidJsonEscapes(json: string): string {
  return json.replace(/\\([<>])/g, "$1");
}

/** String values that look like JSON become their parsed form; everything else passes through. */
export const parseJsonStringValues = (
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
      const sanitized = sanitizeInvalidJsonEscapes(trimmed);
      if (sanitized !== trimmed) {
        try {
          result[key] = JSON.parse(sanitized);
          continue;
        } catch {
          // still broken, fall through
        }
      }
      result[key] = value;
    }
  }

  return result;
};

export function normalizeOtlpAttributes(
  attributes: OtlpKeyValue[],
): NormalizedAttributes {
  const normalizedAttributes: NormalizedAttributes = {};

  for (const attr of attributes ?? []) {
    if (!attr?.key || !attr.value) continue;

    const flattened = normalizeOtlpAnyValue(attr.value, attr.key);
    for (const [k, v] of Object.entries(flattened)) {
      const nv = normalizeOtlpAttributeValue(v);
      if (nv !== void 0) normalizedAttributes[k] = nv;
    }
  }

  return parseJsonStringValues(
    reconstructFlattenedArrays(normalizedAttributes),
  );
}

/**
 * Bit 8 says whether bit 9 carries a meaning at all, so `remote` stays null
 * unless the sender declared it (https://www.w3.org/TR/trace-context-2).
 */
function parseTraceFlags(spanFlags: number | undefined | null): TraceFlagsInfo {
  if (spanFlags === void 0 || spanFlags === null) {
    return { sampled: null, remote: null };
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
}

/** `TraceState` from @opentelemetry/core owns the header's edge cases. */
function parseTraceState(
  traceState: string | null | undefined,
): TraceStateInfo {
  if (traceState === void 0 || traceState === null) {
    return { version: null, versionFormat: null, traceId: null, spanId: null };
  }

  const parsed = new TraceState(traceState);
  return {
    version: parsed.get("version") ?? null,
    versionFormat: parsed.get("versionFormat") ?? null,
    traceId: parsed.get("traceId") ?? null,
    spanId: parsed.get("spanId") ?? null,
  };
}
