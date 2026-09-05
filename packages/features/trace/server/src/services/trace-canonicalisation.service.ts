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
import { ClaudeCodeCanonicaliserService } from "./claude-code-canonicaliser.service";
import { CodexCanonicaliserService } from "./codex-canonicaliser.service";
import { CopilotCanonicaliserService } from "./copilot-canonicaliser.service";
import { FallbackCanonicaliserService } from "./fallback-canonicaliser.service";
import { GenAICanonicaliserService } from "./gen-ai-canonicaliser.service";
import { HaystackCanonicaliserService } from "./haystack-canonicaliser.service";
import { LangWatchCanonicaliserService } from "./langwatch-canonicaliser.service";
import { LegacyOtelCanonicaliserService } from "./legacy-otel-canonicaliser.service";
import { LogfireCanonicaliserService } from "./logfire-canonicaliser.service";
import { MastraCanonicaliserService } from "./mastra-canonicaliser.service";
import { OpenInferenceCanonicaliserService } from "./openinference-canonicaliser.service";
import { SpringAICanonicaliserService } from "./spring-ai-canonicaliser.service";
import { StrandsCanonicaliserService } from "./strands-canonicaliser.service";
import { TraceloopCanonicaliserService } from "./traceloop-canonicaliser.service";
import { VercelCanonicaliserService } from "./vercel-canonicaliser.service";
import { VertexAdkCanonicaliserService } from "./vertex-adk-canonicaliser.service";
import type { ExtractorContext, LogExtractorContext } from "../ports/canonical-attributes.port";
import {
  CanonicalAttributesPort,
  CanonicalLogRecordStore,
  CanonicalSpanStore,
} from "../ports/canonical-attributes.port";
import { parseJsonStringValues } from "../rules/canonical-json.rules";
import {
  extractLastUserMessageText,
  extractMessageContentText,
} from "../rules/canonical-message.rules";
import {
  claudeCacheWritesLongLived,
  isConversationalQuerySource,
} from "../rules/claude-code-call-policy.rules";
import { ClaudeCodeRequestService } from "./claude-code-request.service";
import { ClaudeCodeResponseService } from "./claude-code-response.service";

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
