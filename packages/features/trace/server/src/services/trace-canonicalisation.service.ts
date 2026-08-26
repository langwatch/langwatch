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
import { ClaudeCodeCanonicalisationAdapter } from "../adapters/claude-code-canonicalisation.adapter";
import { CodexCanonicalisationAdapter } from "../adapters/codex-canonicalisation.adapter";
import { CopilotCanonicalisationAdapter } from "../adapters/copilot-canonicalisation.adapter";
import { FallbackCanonicalisationAdapter } from "../adapters/fallback-canonicalisation.adapter";
import { GenAICanonicalisationAdapter } from "../adapters/gen-ai-canonicalisation.adapter";
import { HaystackCanonicalisationAdapter } from "../adapters/haystack-canonicalisation.adapter";
import { LangWatchCanonicalisationAdapter } from "../adapters/langwatch-canonicalisation.adapter";
import { LegacyOtelCanonicalisationAdapter } from "../adapters/legacy-otel-canonicalisation.adapter";
import { LogfireCanonicalisationAdapter } from "../adapters/logfire-canonicalisation.adapter";
import { MastraCanonicalisationAdapter } from "../adapters/mastra-canonicalisation.adapter";
import { OpenInferenceCanonicalisationAdapter } from "../adapters/openinference-canonicalisation.adapter";
import { SpringAICanonicalisationAdapter } from "../adapters/spring-ai-canonicalisation.adapter";
import { StrandsCanonicalisationAdapter } from "../adapters/strands-canonicalisation.adapter";
import { TraceloopCanonicalisationAdapter } from "../adapters/traceloop-canonicalisation.adapter";
import { VercelCanonicalisationAdapter } from "../adapters/vercel-canonicalisation.adapter";
import { VertexAdkCanonicalisationAdapter } from "../adapters/vertex-adk-canonicalisation.adapter";
import type {
  ExtractorContext,
  LogExtractorContext,
} from "../ports/canonical-attributes.port";
import { CanonicalAttributesPort } from "../ports/canonical-attributes.port";
import { LogRecordDataBag } from "../stores/canonical-log-record.store";
import { SpanDataBag } from "../stores/canonical-span.store";
import { parseJsonStringValues } from "./canonical-json.service";
import {
  extractLastUserMessageText,
  extractMessageContentText,
} from "./canonical-message.service";
import {
  claudeCacheWritesLongLived,
  isConversationalQuerySource,
} from "./claude-code-call-policy.service";
import { deriveClaudeRequestBody } from "./claude-code-request.service";
import { deriveClaudeResponseBody } from "./claude-code-response.service";

export class TraceCanonicalisationService extends TraceCanonicalisationServiceContract {
  private readonly extractors: CanonicalAttributesPort[] = [
    new LangWatchCanonicalisationAdapter(),
    new GenAICanonicalisationAdapter(),
    new VertexAdkCanonicalisationAdapter(),
    new MastraCanonicalisationAdapter(),
    new OpenInferenceCanonicalisationAdapter(),
    new TraceloopCanonicalisationAdapter(),
    new VercelCanonicalisationAdapter(),
    // Native CLI emitters can arrive as spans as well as log records.
    new ClaudeCodeCanonicalisationAdapter(),
    new CodexCanonicalisationAdapter(),
    // Copilot adds its extras after GenAI establishes the standard attributes.
    new CopilotCanonicalisationAdapter(),
    new SpringAICanonicalisationAdapter(),
    new StrandsCanonicalisationAdapter(),
    new LogfireCanonicalisationAdapter(),
    new HaystackCanonicalisationAdapter(),
    new LegacyOtelCanonicalisationAdapter(),
    new FallbackCanonicalisationAdapter(),
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
    const bag = new SpanDataBag(
      parseJsonStringValues(parsed.spanAttributes),
      parsed.events,
    );
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
    const lastUserText =
      parsed.mode === "input" ? extractLastUserMessageText(parsed.value) : null;

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
    const derived = deriveClaudeRequestBody(body);
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
    return deriveClaudeResponseContentResultSchema.parse(deriveClaudeResponseBody(body));
  }

  classifyClaudeCall(input: ClassifyClaudeCallInput): ClassifyClaudeCallResult {
    const parsed = classifyClaudeCallInputSchema.parse(input);

    return classifyClaudeCallResultSchema.parse({
      conversational: isConversationalQuerySource(parsed.querySource),
      cacheWritesLongLived: claudeCacheWritesLongLived(parsed),
    });
  }
}
