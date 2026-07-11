import type { NormalizedSpan } from "../../schemas/spans";

/**
 * A coding-agent INTERACTION, summarised at write time.
 *
 * `ComputedInput` / `ComputedOutput` model a conversation: one thing asked, one
 * thing answered. That fits a chat trace and badly misfits a coding agent. Here
 * the input genuinely IS the user's prompt — but the "output" is only the
 * closing remark. The interaction itself was: read twelve files, run the tests,
 * edit three of them, spawn two sub-agents, get a `rm -rf` denied, spend $0.42.
 * None of that survives into a single output string, so the trace list showed a
 * sentence where the work should be.
 *
 * The fix is not a better string. It is to summarise the WORK alongside the
 * answer — what ran, how much of it, and what went wrong.
 *
 * These land as ordinary trace-summary attributes (`langwatch.interaction.*`),
 * so they are queryable like any other attribute and need no product-specific
 * table. They are counted from the spans as they fold, so reads pay nothing.
 */
const LLM_REQUEST_SPAN = "claude_code.llm_request";
const TOOL_SPAN = "claude_code.tool";
const SUBAGENT_SPAWN_SPAN = "claude_code.subagent.spawn";

/** How many distinct file paths we keep. A big refactor touches hundreds. */
const MAX_FILES_TRACKED = 20;

export const INTERACTION_ATTRS = {
  /** Model calls in the loop — 1 is a straight answer, 20 is a long agentic run. */
  MODEL_CALLS: "langwatch.interaction.model_calls",
  /** Total tool runs. */
  TOOL_CALLS: "langwatch.interaction.tool_calls",
  /** Which tools, and how often: `{"Bash":5,"Edit":3}`. */
  TOOLS: "langwatch.interaction.tools",
  /** Distinct files the interaction touched (Read / Edit / Write). */
  FILES_TOUCHED: "langwatch.interaction.files_touched",
  /** Sub-agents spawned (the Agent/Task tool). */
  SUB_AGENTS: "langwatch.interaction.sub_agents",
  /** Tool runs that failed. */
  FAILED_TOOLS: "langwatch.interaction.failed_tools",
} as const;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInt(attributes: Record<string, string>, key: string): number {
  const n = Number(attributes[key] ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function readJsonRecord(
  attributes: Record<string, string>,
  key: string,
): Record<string, number> {
  const raw = attributes[key];
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function readJsonArray(
  attributes: Record<string, string>,
  key: string,
): string[] {
  const raw = attributes[key];
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Fold one span into the interaction summary. Returns ONLY the attributes that
 * changed, so a non-coding-agent span (and every ordinary LLM trace) costs one
 * name comparison and nothing else.
 */
export function accumulateInteractionSummary({
  attributes,
  span,
}: {
  /** The trace summary's attributes so far. */
  attributes: Record<string, string>;
  span: NormalizedSpan;
}): Record<string, string> {
  if (span.name === LLM_REQUEST_SPAN) {
    return {
      [INTERACTION_ATTRS.MODEL_CALLS]: String(
        readInt(attributes, INTERACTION_ATTRS.MODEL_CALLS) + 1,
      ),
    };
  }

  if (span.name === SUBAGENT_SPAWN_SPAN) {
    return {
      [INTERACTION_ATTRS.SUB_AGENTS]: String(
        readInt(attributes, INTERACTION_ATTRS.SUB_AGENTS) + 1,
      ),
    };
  }

  if (span.name !== TOOL_SPAN) return {};

  const next: Record<string, string> = {
    [INTERACTION_ATTRS.TOOL_CALLS]: String(
      readInt(attributes, INTERACTION_ATTRS.TOOL_CALLS) + 1,
    ),
  };

  const toolName = str(span.spanAttributes.tool_name);
  if (toolName !== null) {
    const tools = readJsonRecord(attributes, INTERACTION_ATTRS.TOOLS);
    tools[toolName] = (tools[toolName] ?? 0) + 1;
    next[INTERACTION_ATTRS.TOOLS] = JSON.stringify(tools);
  }

  // `file_path` only rides the span when OTEL_LOG_TOOL_DETAILS is on; without it
  // we still get the counts, just not the paths.
  const filePath = str(span.spanAttributes.file_path);
  if (filePath !== null) {
    const files = readJsonArray(attributes, INTERACTION_ATTRS.FILES_TOUCHED);
    if (!files.includes(filePath) && files.length < MAX_FILES_TRACKED) {
      files.push(filePath);
      next[INTERACTION_ATTRS.FILES_TOUCHED] = JSON.stringify(files);
    }
  }

  if (span.statusCode === "error") {
    next[INTERACTION_ATTRS.FAILED_TOOLS] = String(
      readInt(attributes, INTERACTION_ATTRS.FAILED_TOOLS) + 1,
    );
  }

  return next;
}
