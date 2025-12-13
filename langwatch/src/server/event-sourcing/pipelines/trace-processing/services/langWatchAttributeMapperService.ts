import type { Attributes } from "@opentelemetry/api";
import type { RAGSpan, Span } from "../../../../tracer/types";

/**
 * Service for mapping LangWatch-specific attributes that don't have GenAI equivalents.
 *
 * Handles:
 * - Span type (langwatch.span.type)
 * - RAG contexts (langwatch.rag.contexts)
 * - Remaining params not mapped to GenAI attributes (langwatch.params)
 *
 * @example
 * ```typescript
 * const mapper = new LangWatchAttributeMapperService();
 * const attributes = mapper.mapLangWatchAttributes(span);
 * ```
 */
export class LangWatchAttributeMapperService {
  /**
   * Maps LangWatch-specific attributes that don't have GenAI equivalents.
   * Uses functional composition for better maintainability.
   *
   * @param langWatchSpan - The LangWatch span to map attributes from
   * @returns LangWatch-specific attributes
   */
  mapLangWatchAttributes(langWatchSpan: Span): Attributes {
    return {
      ...this.mapSpanTypeAttribute(langWatchSpan),
      ...this.mapRagContexts(langWatchSpan),
      ...this.mapRemainingParams(langWatchSpan),
    };
  }

  /**
   * Maps the span type attribute.
   */
  private mapSpanTypeAttribute(span: Span): Attributes {
    return {
      "langwatch.span.type": span.type,
    };
  }

  /**
   * Checks if a span is a RAG span.
   */
  private isRagSpan(span: Span): span is RAGSpan {
    return span.type === "rag";
  }

  /**
   * Maps RAG contexts if the span is a RAG span.
   */
  private mapRagContexts(span: Span): Attributes {
    if (!this.isRagSpan(span)) return {};

    const contexts = span.contexts;
    return contexts && contexts.length > 0
      ? { "langwatch.rag.contexts": JSON.stringify(contexts) }
      : {};
  }

  /**
   * Maps remaining params that are not GenAI semantic convention attributes.
   */
  private mapRemainingParams(span: Span): Attributes {
    if (!span.params) return {};

    const genAiParams = new Set([
      "temperature",
      "max_tokens",
      "top_p",
      "frequency_penalty",
      "presence_penalty",
      "stop",
      "seed",
      "n",
    ]);

    const remainingParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(span.params)) {
      if (genAiParams.has(key)) continue;
      remainingParams[key] = value;
    }

    return Object.keys(remainingParams).length > 0
      ? { "langwatch.params": JSON.stringify(remainingParams) }
      : {};
  }
}

export const langWatchAttributeMapperService =
  new LangWatchAttributeMapperService();
