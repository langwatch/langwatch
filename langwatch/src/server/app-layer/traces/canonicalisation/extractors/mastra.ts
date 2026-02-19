/**
 * Mastra Extractor
 *
 * Handles: Mastra framework telemetry (mastra.* namespace)
 * Reference: https://mastra.ai/
 *
 * Mastra is an AI orchestration framework. This extractor handles mastra.span.type
 * to map Mastra's span types to canonical types.
 *
 * Detection: Instrumentation scope name is "@mastra/otel"
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
    // Only process spans from Mastra instrumentation
    // ─────────────────────────────────────────────────────────────────────────
    if (span.instrumentationScope.name !== "@mastra/otel") {
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
  }
}
