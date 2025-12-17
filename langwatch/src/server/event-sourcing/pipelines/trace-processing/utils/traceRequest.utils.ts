import {
  ESpanKind,
  type EStatusCode,
  type ISpan,
} from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import type {
  Fixed64,
  IAnyValue,
  IKeyValue,
} from "@opentelemetry/otlp-transformer-next/build/esm/common/internal-types";
import { TraceState } from "@opentelemetry/core";
import { NormalizedSpanKind,NormalizedStatusCode,type NormalizedAttributes } from "../schemas/spans";
import { match } from "ts-pattern";

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

type AttributeScalar = string | boolean | number | bigint | Uint8Array;
type AttributeValue = AttributeScalar | AttributeScalar[];

type FlattenResult = Record<string, AttributeValue>;

const SEP = ".";

const escapeKey = (k: string): string =>
  k.replaceAll("\\", "\\\\").replaceAll(SEP, `\\${SEP}`);

const join = (prefix: string, key: string): string =>
  prefix ? `${prefix}${SEP}${escapeKey(key)}` : escapeKey(key);

const indexKey = (prefix: string, i: number): string =>
  prefix ? `${prefix}${SEP}${i}` : String(i);

const scalar = (v: IAnyValue): AttributeScalar | undefined => {
  if ("stringValue" in v && v.stringValue) return v.stringValue;
  if ("boolValue" in v && v.boolValue) return v.boolValue;
  if ("intValue" in v && v.intValue) return v.intValue;
  if ("doubleValue" in v && v.doubleValue) return v.doubleValue;
  if ("bytesValue" in v && v.bytesValue) return v.bytesValue;
  return void 0;
};

const isScalar = (v: IAnyValue): boolean => scalar(v) !== void 0;

const normalizeOtlpId = (id: string | Uint8Array): string => {
  if (id instanceof Uint8Array) {
    return Buffer.from(id).toString("hex");
  }

  return id;
};

const normalizeOtlpSpanIds = (
  span: ISpan
): { traceId: string; spanId: string } => {
  const traceId = normalizeOtlpId(span.traceId);
  const spanId = normalizeOtlpId(span.spanId);

  return { traceId, spanId };
};

const normalizeOtlpUnixNano = (value: Fixed64): BigInt => {
  if (typeof value === "string") {
    return BigInt(value);
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (typeof value === "object" && "high" in value && "low" in value) {
    const { high, low } = value;

    if (typeof high === "number" && typeof low === "number") {
      const bigIntValue = (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn);

      return bigIntValue;
    }
  }

  throw new Error(`Invalid Unix nano value: ${value}`);
};

const normalizeOtlpParentAndTraceContext = (
  parentOtlpSpanId: string | Uint8Array | undefined,
  traceState: string | null | undefined,
  spanFlags: number | undefined
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

const normalizeOtlpSpanKind = (kind: ESpanKind): NormalizedSpanKind => {
  return match(kind)
    .with(ESpanKind.SPAN_KIND_UNSPECIFIED, () => NormalizedSpanKind.UNSPECIFIED)
    .with(ESpanKind.SPAN_KIND_INTERNAL, () => NormalizedSpanKind.INTERNAL)
    .with(ESpanKind.SPAN_KIND_SERVER, () => NormalizedSpanKind.SERVER)
    .with(ESpanKind.SPAN_KIND_CLIENT, () => NormalizedSpanKind.CLIENT)
    .with(ESpanKind.SPAN_KIND_PRODUCER, () => NormalizedSpanKind.PRODUCER)
    .with(ESpanKind.SPAN_KIND_CONSUMER, () => NormalizedSpanKind.CONSUMER)
    .otherwise(() => NormalizedSpanKind.UNSPECIFIED);
};

const normalizeOtlpStatusCode = (statusCode: EStatusCode): NormalizedStatusCode => {
  return match(statusCode)
    .with(0, () => NormalizedStatusCode.UNSET)
    .with(1, () => NormalizedStatusCode.OK)
    .with(2, () => NormalizedStatusCode.ERROR)
    .otherwise(() => NormalizedStatusCode.UNSET);
}

const normalizeOtlpAnyValue = (
  root: IAnyValue,
  rootKey?: string
): FlattenResult => {
  const out: FlattenResult = {};

  const set = (k: string | undefined | null, v: AttributeValue) => {
    if (!k) return;
    out[k] = v; // last write wins
  };

  const walk = (v: IAnyValue, prefix: string) => {
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
          vs.map((x) => scalar(x)!).filter((x): x is AttributeScalar => x !== void 0),
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
    if (rootKey) set(escapeKey(rootKey), rootScalar);
    return out;
  }

  walk(root, rootKey ? escapeKey(rootKey) : "");
  return out;
};

const normalizeOtlpAttributeValue = (
  v: AttributeValue
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

const normalizeOtlpAttributes = (attributes: IKeyValue[]): NormalizedAttributes => {
  const normalizedAttributes: NormalizedAttributes = {};

  for (const attr of attributes ?? []) {
    if (!attr?.key || !attr.value) continue;

    const flattened = normalizeOtlpAnyValue(attr.value, attr.key);

    for (const [k, v] of Object.entries(flattened)) {
      const nv = normalizeOtlpAttributeValue(v);
      if (nv !== void 0) normalizedAttributes[k] = nv;
    }
  }

  return normalizedAttributes;
};

const convertUnixNanoToUnixMs = (unixNano: BigInt): number => {
  return Math.round(Number(unixNano) / 1_000_000);
};

/**
 * Parses the trace flags from the span flags.
 *
 * Reference: https://www.w3.org/TR/trace-context-2/#trace-flags
 * @param spanFlags - The span flags.
 * @returns The trace flags info.
 */
const parseTraceFlags = (spanFlags: number | undefined): TraceFlagsInfo => {
  if (spanFlags === void 0) {
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
  traceState: string | null | undefined
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
