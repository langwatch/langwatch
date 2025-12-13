import type { Attributes, AttributeValue } from "@opentelemetry/api";
import { SpanKind } from "@opentelemetry/api";
import type { IAnyValue, IKeyValue } from "@opentelemetry/otlp-transformer";
import { ESpanKind } from "@opentelemetry/otlp-transformer";
import { pipe } from "fp-ts/function";
import { filter, reduce } from "fp-ts/Array";
import { match, P } from "ts-pattern";
import type { DeepPartial } from "../../../../../utils/types";

/**
 * Branded type for Unix nanoseconds timestamp
 */
export type UnixNano = number & { readonly __brand: "UnixNano" };

/**
 * Branded type for milliseconds timestamp
 */
export type Milliseconds = number & { readonly __brand: "Milliseconds" };

/**
 * Discriminated union for OTEL value types
 */
export type OTelValue =
  | { type: "string"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "int"; value: number }
  | { type: "double"; value: number }
  | { type: "array"; value: (string | number | boolean | null)[] }
  | { type: "kvlist"; value: Record<string, string | number | boolean> };

/**
 * Discriminated union for LangWatch span types
 */
export type SpanType =
  | "span"
  | "llm"
  | "chain"
  | "tool"
  | "agent"
  | "rag"
  | "guardrail"
  | "evaluation"
  | "workflow"
  | "component"
  | "module"
  | "server"
  | "client"
  | "producer"
  | "consumer"
  | "task"
  | "unknown";

/**
 * Filters out undefined values from an attributes record.
 *
 * @param attrs - The attributes record to filter
 * @returns A new record with only defined values
 *
 * @example
 * ```typescript
 * const filtered = filterUndefinedAttributes({
 *   key1: "value",
 *   key2: undefined,
 *   key3: 123,
 * });
 * // Result: { key1: "value", key3: 123 }
 * ```
 */
function filterUndefinedAttributes(
  attrs: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | string[] | number[] | boolean[]> {
  if (!attrs) return {};

  return pipe(
    Object.entries(attrs),
    filter(([, value]) => value !== undefined),
    reduce(
      {} as Record<
        string,
        string | number | boolean | string[] | number[] | boolean[]
      >,
      (acc, [key, value]) => {
        acc[key] = value as
          | string
          | number
          | boolean
          | string[]
          | number[]
          | boolean[];
        return acc;
      },
    ),
  );
}

/**
 * Converts Unix nanoseconds timestamp to milliseconds
 */
function unixNanoToMs(
  timestamp:
    | DeepPartial<{ low: number; high: number }>
    | number
    | string
    | undefined,
): Milliseconds | undefined {
  if (timestamp === undefined || timestamp === null) {
    return undefined;
  }

  if (typeof timestamp === "number") {
    return Math.round(timestamp / 1_000_000) as Milliseconds;
  }

  if (typeof timestamp === "string") {
    const num = parseInt(timestamp, 10);
    return isNaN(num)
      ? undefined
      : (Math.round(num / 1_000_000) as Milliseconds);
  }

  // Handle Long format (high/low bits)
  if (
    typeof timestamp === "object" &&
    "high" in timestamp &&
    "low" in timestamp
  ) {
    const { high, low } = timestamp as { high: number; low: number };
    if (typeof high === "number" && typeof low === "number") {
      const value = (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn);
      return Math.round(Number(value) / 1_000_000) as Milliseconds;
    }
  }

  return undefined;
}

/**
 * Converts milliseconds timestamp to Unix nanoseconds (hrtime format)
 */
function msToUnixNano(
  timestamp: Milliseconds | undefined,
): [number, number] | undefined {
  if (timestamp === undefined) {
    return undefined;
  }

  const nanoseconds = BigInt(timestamp) * 1_000_000n;
  const seconds = Number(nanoseconds / 1_000_000_000n);
  const nanos = Number(nanoseconds % 1_000_000_000n);

  return [seconds, nanos];
}

/**
 * Maps ESpanKind to SpanKind
 */
const mapESpanKindToSpanKind = (kind: ESpanKind): SpanKind | undefined =>
  match(kind)
    .with(ESpanKind.SPAN_KIND_SERVER, () => SpanKind.SERVER)
    .with(ESpanKind.SPAN_KIND_CLIENT, () => SpanKind.CLIENT)
    .with(ESpanKind.SPAN_KIND_PRODUCER, () => SpanKind.PRODUCER)
    .with(ESpanKind.SPAN_KIND_CONSUMER, () => SpanKind.CONSUMER)
    .with(ESpanKind.SPAN_KIND_INTERNAL, () => SpanKind.INTERNAL)
    .otherwise(() => undefined);

/**
 * Type-based span kind mapping
 */
const SPAN_TYPE_TO_KIND: Record<SpanType, SpanKind> = {
  span: SpanKind.INTERNAL,
  llm: SpanKind.INTERNAL,
  chain: SpanKind.INTERNAL,
  tool: SpanKind.INTERNAL,
  agent: SpanKind.INTERNAL,
  rag: SpanKind.INTERNAL,
  guardrail: SpanKind.INTERNAL,
  evaluation: SpanKind.INTERNAL,
  workflow: SpanKind.INTERNAL,
  component: SpanKind.INTERNAL,
  module: SpanKind.INTERNAL,
  server: SpanKind.SERVER,
  client: SpanKind.CLIENT,
  producer: SpanKind.PRODUCER,
  consumer: SpanKind.CONSUMER,
  task: SpanKind.INTERNAL,
  unknown: SpanKind.INTERNAL,
};

/**
 * Converts LangWatch span type to OpenTelemetry SpanKind
 */
function convertSpanKind(
  langWatchType: SpanType,
  originalKind: DeepPartial<ESpanKind> | undefined,
): SpanKind {
  // Try to preserve original kind if available
  if (originalKind !== undefined && originalKind !== null) {
    const mappedKind = mapESpanKindToSpanKind(originalKind as ESpanKind);
    if (mappedKind !== undefined) {
      return mappedKind;
    }
  }

  return SPAN_TYPE_TO_KIND[langWatchType] ?? SpanKind.INTERNAL;
}

/**
 * Type-based GenAI operation name mapping
 */
const SPAN_TYPE_TO_OPERATION: Partial<Record<SpanType, string>> = {
  llm: "chat",
  agent: "invoke_agent",
  tool: "execute_tool",
  rag: "embeddings",
  chain: "invoke_chain",
  guardrail: "check_guardrail",
  evaluation: "evaluate",
  workflow: "execute_workflow",
  component: "execute_component",
  module: "execute_module",
  task: "execute_task",
};

/**
 * Converts LangWatch span type to GenAI operation name
 */
function convertSpanTypeToGenAiOperationName(
  type: SpanType,
): string | undefined {
  return SPAN_TYPE_TO_OPERATION[type];
}

/**
 * Extracts number from Long-like object
 */
const extractLongNumber = (
  value: unknown,
  method: "toInt" | "toNumber",
): number | undefined => {
  if (typeof value === "object" && value !== null && method in value) {
    const fn = (value as Record<string, unknown>)[method];
    if (typeof fn === "function") {
      return (fn as () => number).call(value);
    }
  }
  return undefined;
};

/**
 * Converts OTEL IAnyValue to a discriminated union type
 */
function otelValueToOTelValue(
  value: DeepPartial<IAnyValue> | undefined,
): OTelValue | undefined {
  if (!value) return undefined;

  return match(value)
    .when(
      (v) => v.stringValue !== undefined && v.stringValue !== null,
      (v) => ({ type: "string" as const, value: v.stringValue! }),
    )
    .when(
      (v) => v.boolValue !== undefined && v.boolValue !== null,
      (v) => ({ type: "bool" as const, value: v.boolValue! }),
    )
    .when(
      (v) => v.intValue !== undefined && v.intValue !== null,
      (v) => {
        const longValue = extractLongNumber(v.intValue, "toInt");
        return { type: "int" as const, value: longValue ?? Number(v.intValue) };
      },
    )
    .when(
      (v) => v.doubleValue !== undefined && v.doubleValue !== null,
      (v) => {
        const longValue = extractLongNumber(v.doubleValue, "toNumber");
        return {
          type: "double" as const,
          value: longValue ?? Number(v.doubleValue),
        };
      },
    )
    .when(
      (v) => v.arrayValue?.values !== undefined,
      (v) => {
        const arrayValues = pipe(
          v.arrayValue!.values!,
          (vals) => vals.map(otelValueToJs),
          filter(
            (val): val is string | number | boolean =>
              typeof val === "string" ||
              typeof val === "number" ||
              typeof val === "boolean",
          ),
        );
        return { type: "array" as const, value: arrayValues };
      },
    )
    .when(
      (v) => v.kvlistValue?.values !== undefined,
      (v) => {
        const result = pipe(
          v.kvlistValue!.values ?? [],
          filter((kv): kv is NonNullable<typeof kv> => kv?.key !== undefined),
          reduce({} as Record<string, string | number | boolean>, (acc, kv) => {
            const kvValue = otelValueToJs(kv.value);
            if (
              typeof kvValue === "string" ||
              typeof kvValue === "number" ||
              typeof kvValue === "boolean"
            ) {
              acc[kv.key!] = kvValue;
            }
            return acc;
          }),
        );
        return { type: "kvlist" as const, value: result };
      },
    )
    .otherwise(() => undefined);
}

/**
 * Converts OTEL IAnyValue to a JavaScript value (legacy function for backward compatibility)
 */
function otelValueToJs(
  value: DeepPartial<IAnyValue> | undefined,
):
  | string
  | number
  | boolean
  | (string | number | boolean | null | undefined)[]
  | Record<string, string | number | boolean>
  | undefined {
  const otelValue = otelValueToOTelValue(value);
  if (!otelValue) return undefined;

  return match(otelValue)
    .with({ type: "string" }, (v) => v.value)
    .with({ type: "bool" }, (v) => v.value)
    .with({ type: "int" }, (v) => v.value)
    .with({ type: "double" }, (v) => v.value)
    .with({ type: "array" }, (v) => v.value)
    .with({ type: "kvlist" }, (v) => v.value)
    .exhaustive();
}

/**
 * Type guard for valid array attribute values
 */
const isValidArrayAttributeValue = (
  values: (string | number | boolean | null)[],
): boolean =>
  values.every(
    (v) =>
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null ||
      v === undefined,
  );

/**
 * Converts OTEL attributes to a flat record, filtering for valid AttributeValue types
 */
function otelAttributesToRecord(
  attributes: DeepPartial<IKeyValue[]> | undefined,
): Attributes {
  return pipe(
    attributes ?? [],
    filter((attr): attr is NonNullable<typeof attr> => attr?.key !== undefined),
    reduce({} as Attributes, (result, attr) => {
      const otelValue = otelValueToOTelValue(attr.value);
      if (!otelValue) return result;

      match(otelValue)
        .with({ type: P.union("string", "bool", "int", "double") }, (v) => {
          result[attr.key!] = v.value;
        })
        .with({ type: "array" }, (v) => {
          if (isValidArrayAttributeValue(v.value)) {
            result[attr.key!] = v.value as AttributeValue;
          }
        })
        .with({ type: "kvlist" }, () => {
          // Skip kvlist values as they're not valid AttributeValues
        })
        .exhaustive();

      return result;
    }),
  );
}

export {
  unixNanoToMs,
  msToUnixNano,
  convertSpanKind,
  convertSpanTypeToGenAiOperationName,
  otelValueToOTelValue,
  otelValueToJs,
  otelAttributesToRecord,
  filterUndefinedAttributes,
};

export const OtelConversionUtils = {
  unixNanoToMs,
  msToUnixNano,
  convertSpanKind,
  convertSpanTypeToGenAiOperationName,
  otelValueToOTelValue,
  otelValueToJs,
  otelAttributesToRecord,
  filterUndefinedAttributes,
} as const;
