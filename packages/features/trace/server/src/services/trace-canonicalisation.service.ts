import {
  classifyClaudeCallInputSchema,
  classifyClaudeCallResultSchema,
  canonicalizeLogRecordInputSchema,
  canonicalizeLogRecordResultSchema,
  canonicalizeSpanAttributesInputSchema,
  canonicalizeSpanAttributesResultSchema,
  deriveClaudeRequestContentInputSchema,
  deriveClaudeRequestContentResultSchema,
  deriveClaudeResponseContentInputSchema,
  deriveClaudeResponseContentResultSchema,
  extractMessageTextInputSchema,
  extractMessageTextResultSchema,
  type ClassifyClaudeCallInput,
  type ClassifyClaudeCallResult,
  type CanonicalizeLogRecordInput,
  type CanonicalizeLogRecordResult,
  type CanonicalizeSpanAttributesInput,
  type CanonicalizeSpanAttributesResult,
  type DeriveClaudeRequestContentInput,
  type DeriveClaudeRequestContentResult,
  type DeriveClaudeResponseContentInput,
  type DeriveClaudeResponseContentResult,
  type ExtractMessageTextInput,
  TraceCanonicalisationService as TraceCanonicalisationServiceContract,
} from "@langwatch/trace-contract";
import { ClaudeCodeCanonicaliser } from "./canonicalisation/claude-code.canonicaliser";
import { CodexCanonicaliser } from "./canonicalisation/codex.canonicaliser";
import { CopilotCanonicaliser } from "./canonicalisation/copilot.canonicaliser";
import { FallbackCanonicaliser } from "./canonicalisation/fallback.canonicaliser";
import { GenAICanonicaliser } from "./canonicalisation/gen-ai.canonicaliser";
import { HaystackCanonicaliser } from "./canonicalisation/haystack.canonicaliser";
import { LangWatchCanonicaliser } from "./canonicalisation/langwatch.canonicaliser";
import { LegacyOtelCanonicaliser } from "./canonicalisation/legacy-otel.canonicaliser";
import { LogfireCanonicaliser } from "./canonicalisation/logfire.canonicaliser";
import { MastraCanonicaliser } from "./canonicalisation/mastra.canonicaliser";
import { OpenInferenceCanonicaliser } from "./canonicalisation/openinference.canonicaliser";
import { SpringAICanonicaliser } from "./canonicalisation/spring-ai.canonicaliser";
import { StrandsCanonicaliser } from "./canonicalisation/strands.canonicaliser";
import { TraceloopCanonicaliser } from "./canonicalisation/traceloop.canonicaliser";
import { VercelCanonicaliser } from "./canonicalisation/vercel.canonicaliser";
import { VertexAdkCanonicaliser } from "./canonicalisation/vertex-adk.canonicaliser";
import type { ExtractorContext, LogExtractorContext } from "../ports/canonical-attributes.port";
import { CanonicalAttributesPort } from "../ports/canonical-attributes.port";
import { LogRecordDataBag } from "../stores/canonical-log-record.bag";
import { SpanDataBag } from "../stores/canonical-span.bag";
import { parseJsonStringValues } from "./canonical-json.rules";
import { extractLastUserMessageText, extractMessageContentText } from "./canonical-message.rules";
import {
  claudeCacheWritesLongLived,
  isConversationalQuerySource,
} from "./claude-code-call-policy.rules";
import { ClaudeCodeRequest } from "./claude-code-request.rules";
import { ClaudeCodeResponse } from "./claude-code-response.rules";

export class TraceCanonicalisationService extends TraceCanonicalisationServiceContract {
  private readonly extractors: CanonicalAttributesPort[] = [
    new LangWatchCanonicaliser(),
    new GenAICanonicaliser(),
    new VertexAdkCanonicaliser(),
    new MastraCanonicaliser(),
    new OpenInferenceCanonicaliser(),
    new TraceloopCanonicaliser(),
    new VercelCanonicaliser(),
    // Native CLI emitters can arrive as spans as well as log records.
    new ClaudeCodeCanonicaliser(),
    new CodexCanonicaliser(),
    // Copilot adds its extras after GenAI establishes the standard attributes.
    new CopilotCanonicaliser(),
    new SpringAICanonicaliser(),
    new StrandsCanonicaliser(),
    new LogfireCanonicaliser(),
    new HaystackCanonicaliser(),
    new LegacyOtelCanonicaliser(),
    new FallbackCanonicaliser(),
  ];

  private constructor() {
    super();
  }

  static create(): TraceCanonicalisationService {
    return new TraceCanonicalisationService();
  }

  canonicalizeSpanAttributes(
    input: CanonicalizeSpanAttributesInput,
  ): CanonicalizeSpanAttributesResult {
    const parsed = canonicalizeSpanAttributesInputSchema.parse(input);
    const bag = new SpanDataBag(parseJsonStringValues(parsed.spanAttributes), parsed.events);
    const out: ExtractorContext["out"] = {};
    const appliedRules: string[] = [];

    const recordRule = (ruleId: string) => appliedRules.push(ruleId);

    const setAttr = (key: string, value: unknown) => {
      if (value === null || value === void 0) {
        return;
      }

      out[key] = value;
    };

    const setAttrIfAbsent = (key: string, value: unknown) => {
      if (bag.attrs.has(key) || out[key] !== void 0) {
        return;
      }

      setAttr(key, value);
    };

    for (const ex of this.extractors) {
      ex.apply({
        bag,
        out,
        recordRule,
        span: parsed.span,
        setAttr,
        setAttrIfAbsent,
      });
    }

    const merged: ExtractorContext["out"] = {
      ...bag.attrs.remaining(),
      ...out,
    };

    return canonicalizeSpanAttributesResultSchema.parse({
      attributes: merged,
      events: bag.events.remaining(),
      appliedRules,
    });
  }

  canonicalizeLogRecord(input: CanonicalizeLogRecordInput): CanonicalizeLogRecordResult {
    const parsed = canonicalizeLogRecordInputSchema.parse(input);
    const bag = new LogRecordDataBag(
      parsed.scopeName,
      parsed.body,
      parseJsonStringValues(parsed.attributes),
    );
    const out: LogExtractorContext["out"] = {};
    const appliedRules: string[] = [];

    const recordRule = (ruleId: string) => appliedRules.push(ruleId);
    const setAttr = (key: string, value: unknown) => {
      if (value === null || value === void 0) {
        return;
      }

      out[key] = value;
    };
    const setAttrIfAbsent = (key: string, value: unknown) => {
      if (out[key] !== void 0) {
        return;
      }

      setAttr(key, value);
    };

    for (const extractor of this.extractors) {
      extractor.applyLog?.({
        bag,
        out,
        recordRule,
        setAttr,
        setAttrIfAbsent,
      });
    }

    return canonicalizeLogRecordResultSchema.parse({
      attributes: out,
      appliedRules,
    });
  }

  tryExtractMessageText(input: ExtractMessageTextInput): string | null {
    const parsed = extractMessageTextInputSchema.parse(input);
    const lastUserText = parsed.mode === "input" ? extractLastUserMessageText(parsed.value) : null;

    if (lastUserText !== null) {
      return extractMessageTextResultSchema.parse(lastUserText);
    }

    const values = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    const text = values
      .map(extractMessageContentText)
      .filter((value): value is string => value !== null)
      .join("\n");

    return extractMessageTextResultSchema.parse(text.length > 0 ? text : null);
  }

  deriveClaudeRequestContent(
    input: DeriveClaudeRequestContentInput,
  ): DeriveClaudeRequestContentResult {
    const { body } = deriveClaudeRequestContentInputSchema.parse(input);
    const derived = ClaudeCodeRequest.deriveClaudeRequestBody(body);
    const toolResults = [...derived.toolResults].map(([useId, text]) => ({
      useId,
      text,
    }));

    return deriveClaudeRequestContentResultSchema.parse({
      messages: derived.messages,
      toolResults,
    });
  }

  deriveClaudeResponseContent(
    input: DeriveClaudeResponseContentInput,
  ): DeriveClaudeResponseContentResult {
    const { body } = deriveClaudeResponseContentInputSchema.parse(input);

    return deriveClaudeResponseContentResultSchema.parse(
      ClaudeCodeResponse.deriveClaudeResponseBody(body),
    );
  }

  classifyClaudeCall(input: ClassifyClaudeCallInput): ClassifyClaudeCallResult {
    const parsed = classifyClaudeCallInputSchema.parse(input);

    return classifyClaudeCallResultSchema.parse({
      conversational: isConversationalQuerySource(parsed.querySource),
      cacheWritesLongLived: claudeCacheWritesLongLived(parsed),
    });
  }
}
