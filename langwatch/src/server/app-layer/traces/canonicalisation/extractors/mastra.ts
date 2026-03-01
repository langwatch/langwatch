/**
 * Mastra Extractor
 *
 * Handles: Mastra framework telemetry (mastra.* namespace)
 * Reference: https://mastra.ai/
 *
 * Mastra is an AI orchestration framework. This extractor handles mastra.span.type
 * to map Mastra's span types to canonical types.
 *
 * Detection (any of):
 * - Instrumentation scope name is "@mastra/otel"
 * - Instrumentation scope name is "@mastra/otel-bridge"
 * - Instrumentation scope name starts with "@mastra/"
 * - Span has "mastra.span.type" attribute
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from mastra.span.type)
 *
 * Mastra span type mappings:
 * - agent_run → agent
 * - workflow_* → workflow
 * - model_generation/model_step/model_chunk → llm
 * - tool_call → tool
 * - mcp_tool_call → mcp_tool
 * - generic/processor_run/workflow_step → span
 */

import { ATTR_KEYS } from "./_constants";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class MastraExtractor implements CanonicalAttributesExtractor {
  readonly id = "mastra";

  apply(ctx: ExtractorContext): void {
    const { span } = ctx;
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
    // Only process spans from Mastra instrumentation.
    // Uses multi-signal detection: scope name prefix OR mastra.span.type attr.
    // ─────────────────────────────────────────────────────────────────────────
    const scopeName = span.instrumentationScope?.name ?? "";
    const isMastra =
      scopeName === "@mastra/otel" ||
      scopeName === "@mastra/otel-bridge" ||
      scopeName.startsWith("@mastra/") ||
      attrs.has(ATTR_KEYS.MASTRA_SPAN_TYPE);

    if (!isMastra) {
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type Mapping
    // Map Mastra's detailed span types to canonical types
    // ─────────────────────────────────────────────────────────────────────────
    if (!attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      const mastraType = attrs.get(ATTR_KEYS.MASTRA_SPAN_TYPE);

      switch (mastraType) {
        // Agent runs
        case "agent_run":
          ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "agent");
          break;

        // Workflow-related spans
        case "workflow_run":
        case "workflow_conditional":
        case "workflow_conditional_eval":
        case "workflow_parallel":
        case "workflow_loop":
        case "workflow_sleep":
        case "workflow_wait_event":
          ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "workflow");
          break;

        // Model/LLM spans
        case "model_generation":
        case "model_step":
        case "model_chunk":
          ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "llm");
          break;

        // Tool calls
        case "tool_call":
          ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "tool");
          break;

        // MCP tool calls
        case "mcp_tool_call":
          ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "mcp_tool");
          break;

        // Generic/utility spans
        case "generic":
        case "processor_run":
        case "workflow_step":
        default:
          ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "span");
          break;
      }

      ctx.recordRule(`${this.id}:mastra.span.type->langwatch.span.type`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // I/O Mapping
    // Map Mastra-specific I/O attributes to canonical langwatch.input/output
    // ─────────────────────────────────────────────────────────────────────────
    const mastraType = attrs.get(ATTR_KEYS.MASTRA_SPAN_TYPE);

    // For agent_run spans: extract last user message from mastra.agent_run.input
    if (mastraType === "agent_run" && !attrs.has(ATTR_KEYS.LANGWATCH_INPUT)) {
      const rawInput = attrs.get(ATTR_KEYS.MASTRA_AGENT_RUN_INPUT);
      if (rawInput !== undefined) {
        const lastUserMessage = extractLastUserMessage(rawInput);
        if (lastUserMessage) {
          ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, lastUserMessage);
          ctx.recordRule(
            `${this.id}:mastra.agent_run.input->langwatch.input`,
          );
        }
      }
    }

    // For model_step spans: extract text from mastra.model_step.output
    if (mastraType === "model_step" && !attrs.has(ATTR_KEYS.LANGWATCH_OUTPUT)) {
      const rawOutput = attrs.get(ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT);
      if (rawOutput !== undefined) {
        const text = extractModelStepOutputText(rawOutput);
        if (text) {
          ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, text);
          ctx.recordRule(
            `${this.id}:mastra.model_step.output->langwatch.output`,
          );
        }
      }
    }
  }
}

/**
 * Extracts the last user message text from a Mastra agent_run input.
 * The input is an array of OpenAI-format messages: [{role, content}].
 */
function extractLastUserMessage(input: unknown): string | null {
  const messages = Array.isArray(input) ? input : null;
  if (!messages) return null;

  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg || typeof msg !== "object") continue;
    if (msg.role !== "user") continue;

    const content = msg.content;
    if (typeof content === "string") return content;

    // Handle content array: [{type: "text", text: "..."}]
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
        } else if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (p.type === "text" && typeof p.text === "string") {
            texts.push(p.text);
          }
        }
      }
      if (texts.length > 0) return texts.join("\n");
    }
  }

  return null;
}

/**
 * Extracts the text field from a Mastra model_step output.
 * The output is: {text: string, toolCalls: [...]}.
 */
function extractModelStepOutputText(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const obj = output as Record<string, unknown>;
  if (typeof obj.text === "string" && obj.text.length > 0) {
    return obj.text;
  }
  return null;
}
