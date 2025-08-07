import {
  Attributes,
  AttributeValue,
  Span,
  SpanContext,
  SpanStatus,
  Link,
  Exception,
} from "@opentelemetry/api";
import semconv from "@opentelemetry/semantic-conventions/incubating";
import * as intSemconv from "./semconv";
import {
  LangWatchSpan,
  LangWatchSpanGenAIAssistantMessageEventBody,
  LangWatchSpanGenAIChoiceEventBody,
  LangWatchSpanGenAISystemMessageEventBody,
  LangWatchSpanGenAIToolMessageEventBody,
  LangWatchSpanGenAIUserMessageEventBody,
  LangWatchSpanMetrics,
  LangWatchSpanRAGContext,
  SemConvAttributes,
  SpanType,
} from "./types";

// import {
//   RecordedEvaluationDetails,
//   recordEvaluation,
// } from "../evaluation/record-evaluation";
// import { EvaluationResultModel } from "../evaluation/types";
// import { Prompt } from "../prompt/prompt";

class LangWatchSpanInternal implements LangWatchSpan {
  constructor(private span: Span) { }

  // OpenTelemetry Span methods with fluent API support
  setAttributes(attributes: SemConvAttributes): this {
    this.span.setAttributes(attributes);
    return this;
  }

  setAttribute(key: keyof SemConvAttributes, value: AttributeValue): this {
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

  // Pass through other Span methods without chaining
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

  // // LangWatch-specific methods
  // recordEvaluation(
  //   details: RecordedEvaluationDetails,
  //   attributes?: Attributes,
  // ): this {
  //   recordEvaluation(details, attributes);
  //   return this;
  // }

  setType(type: SpanType): this {
    this.span.setAttribute(intSemconv.ATTR_LANGWATCH_SPAN_TYPE, type);
    return this;
  }

  setRequestModel(model: string): this {
    this.span.setAttribute(semconv.ATTR_GEN_AI_REQUEST_MODEL, model);
    return this;
  }

  setResponseModel(model: string): this {
    this.span.setAttribute(semconv.ATTR_GEN_AI_RESPONSE_MODEL, model);
    return this;
  }

  setRAGContexts(ragContexts: LangWatchSpanRAGContext[]): this {
    this.span.setAttribute(
      intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS,
      JSON.stringify({
        type: "json",
        value: ragContexts,
      }),
    );
    return this;
  }

  setRAGContext(ragContext: LangWatchSpanRAGContext): this {
    this.span.setAttribute(
      intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS,
      JSON.stringify({
        type: "json",
        value: [ragContext],
      }),
    );
    return this;
  }

  setMetrics(metrics: LangWatchSpanMetrics): this {
    this.span.setAttribute(
      intSemconv.ATTR_LANGWATCH_METRICS,
      JSON.stringify({
        type: "json",
        value: metrics,
      }),
    );
    return this;
  }

  // setSelectedPrompt(prompt: Prompt): this {
  //   this.span.setAttributes({
  //     [intSemconv.ATTR_LANGWATCH_PROMPT_SELECTED_ID]: prompt.id,
  //     [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: prompt.id,
  //     [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: prompt.versionId,
  //     [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: prompt.version,
  //   });
  //   return this;
  // }

  setInput(input: unknown): this {
    this.span.setAttribute(
      intSemconv.ATTR_LANGWATCH_INPUT,
      JSON.stringify({
        type: "json",
        value: input,
      }),
    );
    return this;
  }

  setInputString(input: string): this {
    this.span.setAttribute(
      intSemconv.ATTR_LANGWATCH_INPUT,
      JSON.stringify({
        type: "text",
        value: input,
      }),
    );
    return this;
  }

  setOutput(output: unknown): this {
    this.span.setAttribute(
      intSemconv.ATTR_LANGWATCH_OUTPUT,
      JSON.stringify({
        type: "json",
        value: output,
      }),
    );
    return this;
  }

  setOutputString(output: string): this {
    this.span.setAttribute(
      intSemconv.ATTR_LANGWATCH_OUTPUT,
      JSON.stringify({
        type: "text",
        value: output,
      }),
    );
    return this;
  }

  // /**
  //  * Set the evaluation output for the span.
  //  *
  //  * @param guardrail - Whether the evaluation is a guardrail
  //  * @param output - The evaluation result
  //  * @returns this
  //  */
  // setOutputEvaluation(guardrail: boolean, output: EvaluationResultModel): this {
  //   this.span.setAttribute(
  //     intSemconv.ATTR_LANGWATCH_OUTPUT,
  //     JSON.stringify({
  //       type: guardrail ? "guardrail_result" : "evaluation_result",
  //       value: output,
  //     }),
  //   return setEvaluationOutput(
  //     this.span,
  //     "langwatch.evaluation.output",
  //     { guardrail, output }
  //   );
  //   return this;
  // }


}

/**
 * Creates a LangWatchSpan, which adds additional methods to an OpenTelemetry Span.
 *
 * @param span - The OpenTelemetry Span to add LangWatch methods to/
 * @returns A LangWatchSpan with additional methods for LLM/GenAI observability
 *
 * @example
 * import { createLangWatchSpan } from './span';
 * const otelSpan = tracer.startSpan('llm-call');
 * const span = createLangWatchSpan(otelSpan);
 * span.setType('llm').setInput('Prompt').setOutput('Completion');
 */
export function createLangWatchSpan(span: Span): LangWatchSpan {
  return new LangWatchSpanInternal(span);
}
