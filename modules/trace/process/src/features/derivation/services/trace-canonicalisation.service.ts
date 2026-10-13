import { CODEX_EXEC_SCOPE, isCodexScope } from "@langwatch/coding-agent-contract";
import {
  type AttributeCanonicaliser,
  canonicaliseLogRecord,
  canonicaliseSpanAttributes,
  claudeCacheWritesLongLived,
  ClaudeCodeRequestService,
  ClaudeCodeResponseService,
  extractLastUserMessageText,
  extractMessageContentText,
  isConversationalQuerySource,
  orderedSpanCanonicalisers,
} from "@langwatch/span-normalisation";
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

const claudeCodeResponseService = ClaudeCodeResponseService.create();

const claudeCodeRequestService = ClaudeCodeRequestService.create();

export class TraceCanonicalisationService extends TraceCanonicalisationServiceContract {
  private readonly canonicalisers: readonly AttributeCanonicaliser[] = orderedSpanCanonicalisers({
    codexScopes: { isCodexScope, execScope: CODEX_EXEC_SCOPE },
  });

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

    return canonicalizeSpanAttributesResultSchema.parse(
      canonicaliseSpanAttributes({ canonicalisers: this.canonicalisers, ...parsed }),
    );
  }

  canonicalizeLogRecord(input: CanonicalizeLogRecordInput): CanonicalizeLogRecordResult {
    const parsed = canonicalizeLogRecordInputSchema.parse(input);

    return canonicalizeLogRecordResultSchema.parse(
      canonicaliseLogRecord({ canonicalisers: this.canonicalisers, ...parsed }),
    );
  }

  extractMessageText(input: ExtractMessageTextInput): string | null {
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
