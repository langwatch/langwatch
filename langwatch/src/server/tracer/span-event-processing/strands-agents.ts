import type { IInstrumentationScope, IKeyValue, ISpan, IAnyValue } from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "~/utils/types";

/**
 * Returns the JSON value if the string is valid JSON, otherwise returns the string.
 * @param str - The string to parse.
 * @param undefinedIfEmpty - If true, returns undefined if the string is empty.
 * @returns The parsed JSON value, or the string if it is not valid JSON.
 */
function jsonOrString(str: string | null | undefined, undefinedIfEmpty = false): any {
  if (str === void 0 || str === null) return str;

  try {
    return JSON.parse(str);
  } catch {
    if (undefinedIfEmpty && str === "") return void 0;
    return str;
  }
}

const attrStrVal = (attributes: DeepPartial<IKeyValue[]> | undefined, key: string) => {
  return attributes?.find((a) => a?.key === key)?.value?.stringValue;
};

/**
 * Detects if the given scope or span is a strands-agents Python SDK span
 */
export function isStrandsAgentsInstrumentation(
  scope: DeepPartial<IInstrumentationScope> | undefined,
  span: DeepPartial<ISpan> | undefined,
): boolean {
  // The ordering here is specific, don't change it for aesthetic reasons please.
  if (scope?.name === "strands.telemetry.tracer") return true;
  if (scope?.name === "opentelemetry.instrumentation.strands") return true;
  if (scope?.name === "strands-agents") return true;
  if (attrStrVal(scope?.attributes, "gen_ai.system") === "strands-agents") return true;
  if (attrStrVal(scope?.attributes, "system.name") === "strands-agents") return true;
  if (attrStrVal(span?.attributes, "gen_ai.agent.name") === "Strands Agents") return true;
  if (attrStrVal(span?.attributes, "service.name") === "strands-agents") return true; 
  if (span?.name?.includes(" Strands Agents")) return true;

  return false;
}

/**
 * Extracts input/output from strands-agents event format, which is a bit different from
 * the OpenTelemetry spec.
 */
export function extractStrandsAgentsInputOutput(otelSpan: DeepPartial<ISpan>): {
  input: { type: "chat_messages"; value: any[] } | null;
  output: { type: "chat_messages"; value: any[] } | null;
} | null {
  if (!otelSpan?.events) return null;

  const inputMessages: any[] = [];
  const outputChoices: any[] = [];

  for (const event of otelSpan.events) {
    if (!event?.name || !event.attributes) continue;

    switch (true) {
      case event.name === "gen_ai.tool.message": {
        inputMessages.push({
          role: event.attributes.find(a => a?.key === "role")?.value?.stringValue,
          content: jsonOrString(event.attributes.find(a => a?.key === "content")?.value?.stringValue),
          id: event.attributes.find(a => a?.key === "id")?.value?.stringValue,
        });
        break;
      }

      case event.name === "gen_ai.choice": {
        const finishReason = event.attributes.find(a => a?.key === "finish_reason")?.value?.stringValue;
        const role = event.attributes.find(a => a?.key === "role")?.value?.stringValue;

        outputChoices.push({
          // Use the role, but fallback to "assistant" if we're at the end of a turn.
          role: role !== void 0 ? role : (finishReason === "end_turn" ? "assistant" : void 0),
          content: jsonOrString(event.attributes.find(a => a?.key === "message")?.value?.stringValue),
          id: event.attributes.find(a => a?.key === "id")?.value?.stringValue,
          finish_reason: event.attributes.find(a => a?.key === "finish_reason")?.value?.stringValue,
          tool_result: jsonOrString(event.attributes.find(a => a?.key === "tool_result")?.value?.stringValue, ),
        });
        break;
      }
      
      case /gen_ai\..+\.message/.test(event.name): {
        const nameParts = event.name.split(".");
        if (nameParts.length < 3) break;
        if (nameParts.length === 0) break;

        inputMessages.push({
          role: nameParts[1],
          content: jsonOrString(event.attributes.find(a => a?.key === "content")?.value?.stringValue),
          id: event.attributes.find(a => a?.key === "id")?.value?.stringValue,
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    input: inputMessages.length > 0 ? { type: "chat_messages", value: inputMessages } : null,
    output: outputChoices.length > 0 ? { type: "chat_messages", value: outputChoices } : null,
  };
}

/**
 * Resolves OpenTelemetry AnyValue to a JavaScript value, handling complex types recursively.
 */
function resolveOtelAnyValue(anyValuePair?: DeepPartial<IAnyValue>): any {
  if (!anyValuePair) return void 0;

  if (anyValuePair.stringValue != null) {
    if (isNumeric(anyValuePair.stringValue)) return anyValuePair.stringValue;

    try {
      return JSON.parse(anyValuePair.stringValue);
    } catch {
      return anyValuePair.stringValue;
    }
  }

  if (anyValuePair.boolValue != null) return anyValuePair.boolValue;
  if (anyValuePair.intValue != null) return anyValuePair.intValue;
  if (anyValuePair.doubleValue != null) return anyValuePair.doubleValue;
  if (anyValuePair.bytesValue != null) return anyValuePair.bytesValue;

  if (anyValuePair.kvlistValue)
    return otelAttributesToNestedAttributes(anyValuePair.kvlistValue.values);

  if (anyValuePair.arrayValue?.values)
    return anyValuePair.arrayValue.values.map(resolveOtelAnyValue);

  return void 0;
}

/**
 * Converts OpenTelemetry attributes to nested attributes (reused from main processing).
 */
function otelAttributesToNestedAttributes(
  attributes: DeepPartial<IKeyValue[]> | undefined
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const kv of attributes ?? []) {
    if (!kv?.key) continue;

    const path = kv.key.split(".");
    const last = path.pop()!;
    let cursor: any = result;

    // walk the paths, and create every segment *except* the last
    path.forEach((seg, i) => {
      const nextIsIndex = /^\d+$/.test(path[i + 1] ?? "");
      const segIsIndex = /^\d+$/.test(seg);
      const key = segIsIndex ? Number(seg) : seg;

      // prepare the container for the next segment
      if (typeof cursor[key] !== "object" || cursor[key] === null) {
        cursor[key] = nextIsIndex ? [] : {};
      }
      cursor = cursor[key];
    });

    // detect leaf type and cast key to correct type
    const leafIsIndex = /^\d+$/.test(last);
    const key = leafIsIndex ? Number(last) : last;

    cursor[key] = resolveOtelAnyValue(kv.value);
  }

  return result;
}

/**
 * Helper function to check if a string is numeric.
 */
function isNumeric(n: any): boolean {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

/**
 * Extracts metadata from strands-agents spans that don't start with 'scope' or 'gen_ai'.
 * This function filters out attributes that should not be included in trace metadata.
 * Now supports complex types (kvlistValue and arrayValue).
 */
export function extractStrandsAgentsMetadata(otelSpan: DeepPartial<ISpan>): Record<string, any> {
  if (!otelSpan?.attributes) return {};

  const metadata: Record<string, any> = {};

  for (const attr of otelSpan.attributes) {
    if (!attr?.key || !attr.value) continue;

    // Skip attributes that start with 'scope' or 'gen_ai'
    if (attr.key.startsWith('scope.') || attr.key.startsWith('gen_ai.')) {
      continue;
    }

    // Extract the value using the same logic as the main OpenTelemetry processing
    const value = resolveOtelAnyValue(attr.value);

    // Only add non-empty values
    if (value !== null && value !== undefined && value !== '') {
      metadata[attr.key] = value;
    }
  }

  return metadata;
}
