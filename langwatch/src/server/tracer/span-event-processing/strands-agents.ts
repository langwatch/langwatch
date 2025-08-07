import type { IInstrumentationScope, IKeyValue, ISpan } from "@opentelemetry/otlp-transformer";
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
          role: role ?? finishReason === "end_turn" ? "assistant" : void 0,
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
