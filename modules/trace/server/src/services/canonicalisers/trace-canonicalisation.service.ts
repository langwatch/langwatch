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
import { ClaudeCodeCanonicaliserService } from "./coding-agent/claude-code-canonicaliser.service.ts";
import { CodexCanonicaliserService } from "./coding-agent/codex-canonicaliser.service.ts";
import { CopilotCanonicaliserService } from "./coding-agent/copilot-canonicaliser.service.ts";
import { FallbackCanonicaliserService } from "./otel/fallback-canonicaliser.service.ts";
import { GenAICanonicaliserService } from "./otel/gen-ai-canonicaliser.service.ts";
import { HaystackCanonicaliserService } from "./otel/haystack-canonicaliser.service.ts";
import { LangWatchCanonicaliserService } from "./otel/langwatch-canonicaliser.service.ts";
import { LegacyOtelCanonicaliserService } from "./otel/legacy-otel-canonicaliser.service.ts";
import { LogfireCanonicaliserService } from "./otel/logfire-canonicaliser.service.ts";
import { MastraCanonicaliserService } from "./otel/mastra-canonicaliser.service.ts";
import { OpenInferenceCanonicaliserService } from "./otel/openinference-canonicaliser.service.ts";
import { SpringAICanonicaliserService } from "./otel/spring-ai-canonicaliser.service.ts";
import { StrandsCanonicaliserService } from "./otel/strands-canonicaliser.service.ts";
import { TraceloopCanonicaliserService } from "./traceloop-canonicaliser.service.ts";
import { VercelCanonicaliserService } from "./vercel-canonicaliser.service.ts";
import { VertexAdkCanonicaliserService } from "./vertex-adk-canonicaliser.service.ts";
import type { ExtractorContext, LogExtractorContext } from "../../ports/canonical-attributes.port.ts";
import {
  CanonicalAttributesPort,
  CanonicalLogRecordStore,
  CanonicalSpanStore,
} from "../../ports/canonical-attributes.port.ts";
import { parseJsonStringValues } from "../../rules/canonical-json.rules.ts";
import {
  extractLastUserMessageText,
  extractMessageContentText,
} from "../../rules/canonical-message.rules.ts";
import {
  claudeCacheWritesLongLived,
  isConversationalQuerySource,
} from "../../rules/claude-code-call-policy.rules.ts";
import { ClaudeCodeRequestService } from "./coding-agent/claude-code-request.service.ts";
import { ClaudeCodeResponseService } from "./coding-agent/claude-code-response.service.ts";

const claudeCodeResponseService = ClaudeCodeResponseService.create();

const claudeCodeRequestService = ClaudeCodeRequestService.create();

export class TraceCanonicalisationService extends TraceCanonicalisationServiceContract {
  private readonly extractors: CanonicalAttributesPort[] = [
    LangWatchCanonicaliserService.create(),
    GenAICanonicaliserService.create(),
    VertexAdkCanonicaliserService.create(),
    MastraCanonicaliserService.create(),
    OpenInferenceCanonicaliserService.create(),
    TraceloopCanonicaliserService.create(),
    VercelCanonicaliserService.create(),
    // Native CLI emitters can arrive as spans as well as log records.
    ClaudeCodeCanonicaliserService.create(),
    CodexCanonicaliserService.create(),
    // Copilot adds its extras after GenAI establishes the standard attributes.
    CopilotCanonicaliserService.create(),
    SpringAICanonicaliserService.create(),
    StrandsCanonicaliserService.create(),
    LogfireCanonicaliserService.create(),
    HaystackCanonicaliserService.create(),
    LegacyOtelCanonicaliserService.create(),
    FallbackCanonicaliserService.create(),
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
    const bag = CanonicalSpanStore.create({
      spanAttributes: parseJsonStringValues(parsed.spanAttributes),
      events: parsed.events,
    });
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
    const bag = CanonicalLogRecordStore.create({
      scopeName: parsed.scopeName,
      body: parsed.body,
      attributes: parseJsonStringValues(parsed.attributes),
    });
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
    const derived = claudeCodeRequestService.deriveClaudeRequestBody(body);
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
      claudeCodeResponseService.deriveClaudeResponseBody(body),
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
