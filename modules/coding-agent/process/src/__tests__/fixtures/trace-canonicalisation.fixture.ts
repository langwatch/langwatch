import {
  TraceCanonicalisationService,
  type ClassifyClaudeCallInput,
  type ClassifyClaudeCallResult,
  type DeriveClaudeResponseContentInput,
  type DeriveClaudeResponseContentResult,
} from "@langwatch/trace-contract";

const CONVERSATIONAL_QUERY_SOURCES: ReadonlySet<string> = new Set(["repl_main_thread", "sdk"]);
const MAX_SESSION_TITLE_CHARS = 512;

type ResponseBody = { content?: { type?: string; text?: string }[] };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Trace's canonicalisation answers for the two operations coding-agent asks:
 * the Claude call policy and the title a title-generator body carries. The
 * values mirror trace's; the rest of the boundary answers empty.
 */
export class ClaudeAnswersTraceCanonicalisation extends TraceCanonicalisationService {
  static create(): ClaudeAnswersTraceCanonicalisation {
    return new ClaudeAnswersTraceCanonicalisation();
  }

  canonicalizeSpanAttributes() {
    return { attributes: {}, events: [], appliedRules: [] };
  }

  canonicalizeLogRecord() {
    return { attributes: {}, appliedRules: [] };
  }

  extractMessageText(): null {
    return null;
  }

  deriveClaudeRequestContent() {
    return { messages: null, toolResults: [] };
  }

  deriveClaudeResponseContent({
    body,
  }: DeriveClaudeResponseContentInput): DeriveClaudeResponseContentResult {
    const parsed = typeof body === "string" ? (parseJson(body) as ResponseBody | null) : null;
    const texts = (parsed?.content ?? [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text as string);
    const assistantText = texts.length > 0 ? texts.join("\n\n") : null;

    return { assistantText, assistantOutput: assistantText, sessionTitle: titleOf(assistantText) };
  }

  classifyClaudeCall({
    querySource,
    llmRequestContext,
  }: ClassifyClaudeCallInput): ClassifyClaudeCallResult {
    return {
      conversational: querySource === null || CONVERSATIONAL_QUERY_SOURCES.has(querySource),
      cacheWritesLongLived:
        llmRequestContext === "interaction" || querySource === "repl_main_thread",
    };
  }
}

function titleOf(text: string | null): string | null {
  if (text === null) return null;
  const parsed = parseJson(text) as { title?: unknown } | null;
  if (typeof parsed?.title !== "string") return null;
  const title = parsed.title.trim();

  return title.length > 0 ? title.slice(0, MAX_SESSION_TITLE_CHARS) : null;
}
