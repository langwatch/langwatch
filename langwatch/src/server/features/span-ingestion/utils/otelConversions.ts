import { ESpanKind } from "@opentelemetry/otlp-transformer";
import { SpanKind } from "@opentelemetry/api";
import type { DeepPartial } from "../../../../utils/types";
import type { IAnyValue, IKeyValue } from "@opentelemetry/otlp-transformer";
import type { AttributeValue, Attributes } from "@opentelemetry/api";

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
 * Converts Unix nanoseconds timestamp to milliseconds
 */
export function unixNanoToMs(
  timestamp:
    | DeepPartial<{ low: number; high: number }>
    | number
    | string
    | undefined,
): Milliseconds | undefined {
  if (timestamp === void 0 || timestamp === null) {
    return undefined;
  }

  if (typeof timestamp === "number") {
    return Math.round(timestamp / 1_000_000) as Milliseconds;
  }

  if (typeof timestamp === "string") {
    const num = parseInt(timestamp, 10);
    return isNaN(num) ? undefined : Math.round(num / 1_000_000) as Milliseconds;
  }

  // Handle Long format (high/low bits)
  if (
    typeof timestamp === "object" &&
    timestamp !== null &&
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
export function msToUnixNano(
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
 * Converts LangWatch span type to OpenTelemetry SpanKind
 */
export function convertSpanKind(
  langWatchType: SpanType,
  originalKind: DeepPartial<ESpanKind> | undefined,
): SpanKind {
  // Try to preserve original kind if available
  if (originalKind !== undefined && originalKind !== null) {
    switch (originalKind) {
      case ESpanKind.SPAN_KIND_SERVER:
        return SpanKind.SERVER;
      case ESpanKind.SPAN_KIND_CLIENT:
        return SpanKind.CLIENT;
      case ESpanKind.SPAN_KIND_PRODUCER:
        return SpanKind.PRODUCER;
      case ESpanKind.SPAN_KIND_CONSUMER:
        return SpanKind.CONSUMER;
      case ESpanKind.SPAN_KIND_INTERNAL:
        return SpanKind.INTERNAL;
    }
  }

  // Fallback to type-based mapping
  const typeMappings: Record<SpanType, SpanKind> = {
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

  return typeMappings[langWatchType] ?? SpanKind.INTERNAL;
}

/**
 * Converts LangWatch span type to GenAI operation name
 */
export function convertSpanTypeToGenAiOperationName(
  type: SpanType,
): string | undefined {
  const operationMappings: Partial<Record<SpanType, string>> = {
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

  return operationMappings[type];
}

/**
 * Converts OTEL IAnyValue to a discriminated union type
 */
export function otelValueToOTelValue(
  value: DeepPartial<IAnyValue> | undefined,
): OTelValue | undefined {
  if (!value) return undefined;

  if (value.stringValue !== undefined && value.stringValue !== null) {
    return { type: "string", value: value.stringValue };
  }

  if (value.boolValue !== undefined && value.boolValue !== null) {
    return { type: "bool", value: value.boolValue };
  }

  if (value.intValue !== undefined && value.intValue !== null) {
    // Check if it's a Long object with toInt method
    if (
      typeof value.intValue === "object" &&
      value.intValue !== null &&
      "toInt" in value.intValue
    ) {
      const longObj = value.intValue as { toInt: () => number };
      if (typeof longObj.toInt === "function") {
        return { type: "int", value: longObj.toInt() };
      }
    }
    return { type: "int", value: Number(value.intValue) };
  }

  if (value.doubleValue !== undefined && value.doubleValue !== null) {
    // Check if it's a Long object with toNumber method
    if (
      typeof value.doubleValue === "object" &&
      value.doubleValue !== null &&
      "toNumber" in value.doubleValue
    ) {
      const longObj = value.doubleValue as { toNumber: () => number };
      if (typeof longObj.toNumber === "function") {
        return { type: "double", value: longObj.toNumber() };
      }
    }
    return { type: "double", value: Number(value.doubleValue) };
  }

  if (value.arrayValue?.values) {
    const arrayValues = value.arrayValue.values
      .map(otelValueToJs)
      .filter(
        (v): v is string | number | boolean =>
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean",
      );
    return { type: "array", value: arrayValues };
  }

  if (value.kvlistValue?.values) {
    const result: Record<string, string | number | boolean> = {};
    for (const kv of value.kvlistValue.values ?? []) {
      if (kv?.key) {
        const kvValue = otelValueToJs(kv.value);
        // Only include primitive values in the result
        if (
          typeof kvValue === "string" ||
          typeof kvValue === "number" ||
          typeof kvValue === "boolean"
        ) {
          result[kv.key] = kvValue;
        }
      }
    }
    return { type: "kvlist", value: result };
  }

  return undefined;
}

/**
 * Converts OTEL IAnyValue to a JavaScript value (legacy function for backward compatibility)
 */
export function otelValueToJs(
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

  switch (otelValue.type) {
    case "string":
    case "bool":
    case "int":
    case "double":
      return otelValue.value;
    case "array":
      return otelValue.value;
    case "kvlist":
      return otelValue.value;
  }
}

/**
 * Converts OTEL attributes to a flat record, filtering for valid AttributeValue types
 */
export function otelAttributesToRecord(
  attributes: DeepPartial<IKeyValue[]> | undefined,
): Attributes {
  const result: Attributes = {};

  for (const attr of attributes ?? []) {
    if (attr?.key) {
      const otelValue = otelValueToOTelValue(attr.value);
      if (!otelValue) continue;

      // Only add valid AttributeValue types
      switch (otelValue.type) {
        case "string":
        case "bool":
        case "int":
        case "double":
          result[attr.key] = otelValue.value;
          break;
        case "array":
          // Arrays are valid AttributeValues if they contain primitives
          if (
            otelValue.value.every(
              (v) =>
                typeof v === "string" ||
                typeof v === "number" ||
                typeof v === "boolean" ||
                v === null ||
                v === undefined,
            )
          ) {
            result[attr.key] = otelValue.value as AttributeValue;
          }
          break;
        case "kvlist":
          // Skip kvlist values as they're not valid AttributeValues
          break;
      }
    }
  }

  return result;
}
