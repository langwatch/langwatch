import type { ISpan } from "@opentelemetry/otlp-transformer";
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

/**
 * Detects if the resource attributes indicate a strands-agents Python SDK span
 */
export function isStrandsAgentsPythonResource(
  resource: Record<string, any> | undefined | null
): boolean {
  if (!resource) return false;
  if (typeof resource !== "object") return false;

  return (
    resource["service.name"] === "strands-agents" &&
    resource["telemetry.sdk.language"] === "python"
  );
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
