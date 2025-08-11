import semconv from "@opentelemetry/semantic-conventions/incubating";
import {
  type Span,
  type SpanContext,
  type SpanStatus,
  type Attributes,
  type AttributeValue,
  type Link,
  type Exception,
} from "@opentelemetry/api";
import {
  type LangWatchSpan,
  type LangWatchSpanMetrics,
  type LangWatchSpanRAGContext,
  type SpanType,
} from "./types";
import { type Prompt } from "@/client-sdk/services/prompts";
import { type ChatMessage, type SpanInputOutput } from "../../internal/generated/types/tracer";
import * as intSemconv from "../semconv/attributes";
import { processSpanInputOutput, type SpanInputOutputMethod } from "./input-output";
import type { SemConvAttributeKey, SemConvAttributes } from "../semconv";

class LangWatchSpanInternal implements LangWatchSpan {
  constructor(private span: Span) { }
  setAttributes(attributes: SemConvAttributes): this {
    this.span.setAttributes(attributes);
    return this;
  }

  setAttribute(key: SemConvAttributeKey, value: AttributeValue): this {
    this.span.setAttribute(key, value);
    return this;
  }

  addEvent(name: string, attributes?: Attributes): this {
    this.span.addEvent(name, attributes);
    return this;
  }

  recordException(exception: Exception): this {
    this.span.recordException(exception);
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.span.setStatus(status);
    return this;
  }

  updateName(name: string): this {
    this.span.updateName(name);
    return this;
  }

  end(endTime?: number): void {
    this.span.end(endTime);
  }

  isRecording(): boolean {
    return this.span.isRecording();
  }

  spanContext(): SpanContext {
    return this.span.spanContext();
  }

  addLink(link: Link): this {
    this.span.addLink(link);
    return this;
  }

  addLinks(links: Link[]): this {
    this.span.addLinks(links);
    return this;
  }

  setType(type: SpanType): this {
    return this.setAttribute(intSemconv.ATTR_LANGWATCH_SPAN_TYPE, type);
  }

  setSelectedPrompt(prompt: Prompt): this {
    return this.setAttributes({
      [intSemconv.ATTR_LANGWATCH_PROMPT_SELECTED_ID]: prompt.id,
      [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: prompt.id,
      [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: prompt.versionId,
      [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: prompt.version,
    });
  }

  setRequestModel(model: string): this {
    return this.setAttribute(semconv.ATTR_GEN_AI_REQUEST_MODEL, model);
  }

  setResponseModel(model: string): this {
    return this.setAttribute(semconv.ATTR_GEN_AI_RESPONSE_MODEL, model);
  }

  setRAGContexts(ragContexts: LangWatchSpanRAGContext[]): this {
    return this.setAttribute(
      intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS,
      JSON.stringify({
        type: "json",
        value: ragContexts,
      })
    );
  }

  setRAGContext(ragContext: LangWatchSpanRAGContext): this {
    return this.setRAGContexts([ragContext]);
  }

  setMetrics(metrics: LangWatchSpanMetrics): this {
    return this.setAttribute(
      intSemconv.ATTR_LANGWATCH_METRICS,
      JSON.stringify({
        type: "json",
        value: metrics,
      })
    );
  }

  setInput(type: "text", input: string): this;
  setInput(type: "raw", input: any): this;
  setInput(type: "chat_messages", input: ChatMessage[]): this;
  setInput(type: "list", input: SpanInputOutput[]): this;
  setInput(type: "json", input: any): this;
  setInput(input: any): this;
  setInput(typeOrInput: any, input?: any): this {
    const spanInput = processSpanInputOutput(typeOrInput, input);
    return this.setAttribute(
      intSemconv.ATTR_LANGWATCH_INPUT,
      JSON.stringify(spanInput)
    );
  }

  setOutput(type: "text", output: string): this;
  setOutput(type: "raw", output: any): this;
  setOutput(type: "chat_messages", output: ChatMessage[]): this;
  setOutput(type: "list", output: SpanInputOutput[]): this;
  setOutput(type: "json", output: any): this;
  setOutput(output: any): this;
  setOutput(typeOrOutput: any, output?: any): this {
    const spanOutput = processSpanInputOutput(typeOrOutput, output);
    return this.setAttribute(
      intSemconv.ATTR_LANGWATCH_OUTPUT,
      JSON.stringify(spanOutput)
    );
  }
}

/**
 * Creates a LangWatchSpan, which adds additional methods to an OpenTelemetry Span.
 *
 * @param span - The OpenTelemetry Span to add LangWatch methods to
 * @returns A LangWatchSpan with additional methods for LLM/GenAI observability
 *
 * @example
 * ```typescript
 * import { createLangWatchSpan } from './span';
 * const otelSpan = tracer.startSpan('llm-call');
 * const span = createLangWatchSpan(otelSpan);
 * span.setType('llm').setInput('Prompt').setOutput('Completion');
 * ```
 */
export function createLangWatchSpan(span: Span): LangWatchSpan {
  return new LangWatchSpanInternal(span);
}
