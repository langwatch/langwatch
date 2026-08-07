import type {
  IAnyValue,
  IInstrumentationScope,
  IKeyValue,
  ISpan,
} from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "~/utils/types";

/**
 * Returns the JSON value if the string is valid JSON, otherwise returns the string.
 * @param str - The string to parse.
 * @param undefinedIfEmpty - If true, returns undefined if the string is empty.
 * @returns The parsed JSON value, or the string if it is not valid JSON.
 */
function jsonOrString(
  str: string | null | undefined,
  undefinedIfEmpty = false,
): any {
  if (str === void 0 || str === null) return str;

  try {
    return JSON.parse(str);
  } catch {
    if (undefinedIfEmpty && str === "") return void 0;
    return str;
  }
}

const attrStrVal = (
  attributes: DeepPartial<IKeyValue[]> | undefined,
  key: string,
) => {
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
  if (attrStrVal(scope?.attributes, "gen_ai.system") === "strands-agents")
    return true;
  if (attrStrVal(scope?.attributes, "system.name") === "strands-agents")
    return true;
  if (attrStrVal(span?.attributes, "gen_ai.agent.name") === "Strands Agents")
    return true;
  if (attrStrVal(span?.attributes, "service.name") === "strands-agents")
    return true;
  if (span?.name?.includes(" Strands Agents")) return true;

  return false;
}

function buildStrandsToolMessage(attributes: DeepPartial<IKeyValue[]>) {
  return {
    role: attrStrVal(attributes, "role"),
    content: jsonOrString(attrStrVal(attributes, "content")),
    id: attrStrVal(attributes, "id"),
  };
}

function buildStrandsChoiceMessage(attributes: DeepPartial<IKeyValue[]>) {
  const finishReason = attrStrVal(attributes, "finish_reason");
  const role = attrStrVal(attributes, "role");

  return {
    // Use the role, but fallback to "assistant" if we're at the end of a turn.
    role:
      role !== void 0
        ? role
        : finishReason === "end_turn"
          ? "assistant"
          : void 0,
    content: jsonOrString(attrStrVal(attributes, "message")),
    id: attrStrVal(attributes, "id"),
    finish_reason: finishReason,
    tool_result: jsonOrString(attrStrVal(attributes, "tool_result")),
  };
}

function buildStrandsGenericMessage(
  role: string,
  attributes: DeepPartial<IKeyValue[]>,
) {
  return {
    role,
    content: jsonOrString(attrStrVal(attributes, "content")),
    id: attrStrVal(attributes, "id"),
  };
}

type StrandsAgentEvent = NonNullable<DeepPartial<ISpan>["events"]>[number];

function processStrandsAgentEvent(
  event: StrandsAgentEvent,
  inputMessages: any[],
  outputChoices: any[],
): void {
  if (!event?.name || !event.attributes) return;

  if (event.name === "gen_ai.tool.message") {
    inputMessages.push(buildStrandsToolMessage(event.attributes));
    return;
  }

  if (event.name === "gen_ai.choice") {
    outputChoices.push(buildStrandsChoiceMessage(event.attributes));
    return;
  }

  if (/gen_ai\..+\.message/.test(event.name)) {
    const nameParts = event.name.split(".");
    if (nameParts.length < 3) return;

    inputMessages.push(
      buildStrandsGenericMessage(nameParts[1]!, event.attributes),
    );
  }
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
    processStrandsAgentEvent(event, inputMessages, outputChoices);
  }

  return {
    input:
      inputMessages.length > 0
        ? { type: "chat_messages", value: inputMessages }
        : null,
    output:
      outputChoices.length > 0
        ? { type: "chat_messages", value: outputChoices }
        : null,
  };
}

function resolveOtelStringValue(value: string): any {
  if (isNumeric(value)) return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Resolves OpenTelemetry AnyValue to a JavaScript value, handling complex types recursively.
 */
function resolveOtelAnyValue(anyValuePair?: DeepPartial<IAnyValue>): any {
  if (!anyValuePair) return void 0;

  if (anyValuePair.stringValue != null)
    return resolveOtelStringValue(anyValuePair.stringValue);
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
// prepare the container for the next path segment
function stepIntoPathContainer(
  cursor: any,
  key: string | number,
  createsArray: boolean,
): any {
  if (typeof cursor[key] !== "object" || cursor[key] === null) {
    cursor[key] = createsArray ? [] : {};
  }
  return cursor[key];
}

function otelAttributesToNestedAttributes(
  attributes: DeepPartial<IKeyValue[]> | undefined,
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

      cursor = stepIntoPathContainer(cursor, key, nextIsIndex);
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

const isStrandsScopeOrGenAiKey = (key: string): boolean =>
  key.startsWith("scope.") || key.startsWith("gen_ai.");

function collectStrandsMetadataAttribute(
  attr: DeepPartial<IKeyValue>,
  metadata: Record<string, any>,
): void {
  if (!attr?.key || !attr.value) return;
  if (isStrandsScopeOrGenAiKey(attr.key)) return;

  // Extract the value using the same logic as the main OpenTelemetry processing
  const value = resolveOtelAnyValue(attr.value);

  // Only add non-empty values
  if (value !== null && value !== undefined && value !== "") {
    metadata[attr.key] = value;
  }
}

/**
 * Extracts metadata from strands-agents spans that don't start with 'scope' or 'gen_ai'.
 * This function filters out attributes that should not be included in trace metadata.
 * Now supports complex types (kvlistValue and arrayValue).
 */
export function extractStrandsAgentsMetadata(
  otelSpan: DeepPartial<ISpan>,
): Record<string, any> {
  if (!otelSpan?.attributes) return {};

  const metadata: Record<string, any> = {};

  for (const attr of otelSpan.attributes) {
    collectStrandsMetadataAttribute(attr, metadata);
  }

  return metadata;
}
