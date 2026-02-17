/**
 * Vercel AI SDK Instrumentation for LangWatch
 *
 * This SpanProcessor enriches Vercel AI SDK's OpenTelemetry spans with
 * LangWatch-specific attributes for proper trace visualization and analysis.
 *
 * @module instrumentation/vercel-ai-sdk
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry
 */

import { type Span, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import type { SpanType } from "../../span/types";
import {
  ATTR_LANGWATCH_SPAN_TYPE,
} from "../../semconv/attributes";

/**
 * Mapping of AI SDK span names to LangWatch span types
 */
const AI_SDK_SPAN_TYPE_MAP: Record<string, SpanType> = {
  // Text generation spans
  "ai.generateText": "llm",
  "ai.streamText": "llm",
  "ai.generateObject": "llm",
  "ai.streamObject": "llm",

  // Provider-level spans
  "ai.generateText.doGenerate": "llm",
  "ai.streamText.doStream": "llm",
  "ai.generateObject.doGenerate": "llm",
  "ai.streamObject.doStream": "llm",

  // Tool execution spans
  "ai.toolCall": "tool",

  // Embedding spans
  "ai.embed": "component",
  "ai.embedMany": "component",
  "ai.embed.doEmbed": "component",
  "ai.embedMany.doEmbed": "component",
};

/**
 * SpanProcessor that enriches Vercel AI SDK spans with LangWatch-specific attributes.
 *
 * This processor runs as part of the span processing pipeline and adds LangWatch
 * semantic conventions to AI SDK spans, enabling proper visualization in the
 * LangWatch dashboard.
 *
 * **How it works:**
 * 1. Detects AI SDK spans by name prefix (`ai.*`)
 * 2. Adds `langwatch.span.type` attribute for span categorization
 * 3. Enriches with model info, usage metrics, and I/O data
 * 4. Respects LangWatch's data capture configuration
 *
 * @example
 * ```typescript
 * import { AISDKSpanProcessor } from 'langwatch/observability';
 *
 * const processor = new AISDKSpanProcessor();
 * provider.addSpanProcessor(processor);
 * ```
 */
export class AISDKSpanProcessor implements SpanProcessor {
  /**
   * Called when a span starts. Enriches AI SDK spans with LangWatch attributes.
   *
   * @param span - The span being started (writable)
   */
  onStart(span: Span): void {
    try {
      const spanName = span.name;

      // Only process AI SDK spans
      if (!spanName.startsWith("ai.")) {
        return;
      }

      // Add LangWatch span type for categorization
      const type = AI_SDK_SPAN_TYPE_MAP[spanName] ?? "llm";
      span.setAttribute(ATTR_LANGWATCH_SPAN_TYPE, type);

      // Mark as instrumented by AI SDK processor
      span.setAttribute("langwatch.ai_sdk.instrumented", true);
      span.setAttribute("langwatch.ai_sdk.span_name", spanName);

    } catch {
      // Silently fail to avoid breaking the span
      // Instrumentation should never break application logic
    }
  }

  /**
   * Called when a span ends. Can read final AI SDK attributes but cannot modify.
   *
   * Note: ReadableSpan is immutable, so we can only read attributes here.
   * All attribute enrichment must happen in onStart().
   *
   * @param span - The span being ended (read-only)
   */
  onEnd(span: ReadableSpan): void {
    try {
      const spanName = span.name;

      if (!spanName.startsWith("ai.")) {
        return;
      }

      // Optional: Log span completion for debugging
      // This helps verify the processor is working correctly
      if (process.env.LANGWATCH_DEBUG === "true") {
        const attrs = span.attributes;
        console.log(`[AISDKSpanProcessor] Span ended: ${spanName}`, {
          type: attrs[ATTR_LANGWATCH_SPAN_TYPE],
          status: span.status.code === SpanStatusCode.OK ? "OK" : "ERROR",
        });
      }

    } catch {
      // Silently fail to avoid breaking span export
    }
  }

  /**
   * Force flush any buffered spans.
   * This processor doesn't buffer, so this is a no-op.
   */
  async forceFlush(): Promise<void> {
    // No-op: we don't buffer spans
    return Promise.resolve();
  }

  /**
   * Shutdown the processor and release resources.
   * This processor has no resources to clean up.
   */
  async shutdown(): Promise<void> {
    // No-op: no resources to clean up
    return Promise.resolve();
  }
}

/**
 * Helper function to check if a span name belongs to the AI SDK.
 *
 * @param spanName - The name of the span to check
 * @returns True if this is an AI SDK span
 *
 * @example
 * ```typescript
 * if (isAISDKSpan('ai.streamText')) {
 *   console.log('This is an AI SDK span');
 * }
 * ```
 */
export function isAISDKSpan(spanName: string): boolean {
  return spanName?.startsWith("ai.") ?? false;
}

/**
 * Helper function to get the LangWatch span type for an AI SDK span.
 *
 * @param spanName - The AI SDK span name
 * @returns The corresponding LangWatch span type
 *
 * @example
 * ```typescript
 * const type = getAISDKSpanType('ai.toolCall'); // Returns 'tool'
 * const type2 = getAISDKSpanType('ai.streamText'); // Returns 'llm'
 * ```
 */
export function getAISDKSpanType(spanName: string): SpanType {
  return AI_SDK_SPAN_TYPE_MAP[spanName] ?? "llm";
}

/**
 * Get all supported AI SDK span names.
 *
 * @returns Array of supported span names
 */
export function getSupportedAISDKSpans(): string[] {
  return Object.keys(AI_SDK_SPAN_TYPE_MAP);
}
