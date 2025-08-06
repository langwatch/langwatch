import type { IInstrumentationScope, IKeyValue, ISpan } from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "~/utils/types";

/**
 * Safely parses a JSON string, returning a fallback value if the string is not valid JSON.
 * @param jsonString - The JSON string to parse.
 * @param fallback - The value to return if the string is not valid JSON.
 * @returns The parsed JSON value, or the fallback value if the string is not valid JSON.
 */
function safeJsonParse(jsonString: string, fallback: any = null): any {
  try {
    return JSON.parse(jsonString);
  } catch {
    return fallback;
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
  console.log("scope", scope?.name);
  console.log("span", span?.name);
  console.log("scope attributes", scope?.attributes);
  console.log("span attributes", span?.attributes);

  // The ordering here is specific, don't change it for aesthetic reasons please.
  if (scope?.name === "strands-agents") return true;
  if (scope?.name === "opentelemetry.instrumentation.strands") return true;
  if (attrStrVal(scope?.attributes, "gen_ai.system") === "strands-agents") return true;
  if (attrStrVal(scope?.attributes, "system.name") === "strands-agents") return true;
  if (attrStrVal(span?.attributes, "gen_ai.agent.name") === "Strands Agents") return true;
  if (attrStrVal(span?.attributes, "service.name") === "strands-agents") return true; 

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
          role: event.attributes.find(a => a?.key === "role")?.value?.stringValue ?? "unknown",
          content: safeJsonParse(event.attributes.find(a => a?.key === "content")?.value?.stringValue ?? ""),
          id: event.attributes.find(a => a?.key === "id")?.value?.stringValue,
        });
        break;
      }

      case event.name === "gen_ai.choice": {
        outputChoices.push({
          role: "choice",
          content: safeJsonParse(event.attributes.find(a => a?.key === "message")?.value?.stringValue ?? ""),
          id: event.attributes.find(a => a?.key === "id")?.value?.stringValue ?? void 0,
          finish_reason: event.attributes.find(a => a?.key === "finish_reason")?.value?.stringValue ?? void 0,
        });
        break;
      }
      
      case /gen_ai\..+\.message/.test(event.name): {
        const nameParts = event.name.split(".");
        if (nameParts.length < 3) break;
        if (nameParts.length === 0) break;

        inputMessages.push({
          role: nameParts[1],
          content: safeJsonParse(event.attributes.find(a => a?.key === "content")?.value?.stringValue ?? "{}"),
          id: event.attributes.find(a => a?.key === "id")?.value?.stringValue ?? void 0,
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
