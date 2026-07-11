import { useMemo } from "react";

/**
 * What a coding-agent interaction did, shaped for display.
 *
 * A coding agent's interaction is a unit of WORK, not an exchange: one prompt,
 * then any number of model calls, tool runs and sub-agents. The prompt and the
 * final reply — the only two things a chat-shaped trace row shows — say almost
 * nothing about it. Two rows that look identical can be "answered in one shot"
 * and "ran 40 tools, got cut off, and cost $4".
 *
 * This reads the facts folded onto the trace at ingest (`langwatch.code_agent.*`),
 * so it costs no query and both the list row and the drawer header can render
 * from the same data. Returning DATA (not JSX) keeps this a `.ts` hook and lets
 * the two surfaces render it differently without drifting apart.
 */

/** The `langwatch.code_agent.*` attributes, as folded onto the trace. */
const ATTRS = {
  MODEL_CALLS: "langwatch.code_agent.model_calls",
  TOOL_CALLS: "langwatch.code_agent.tool_calls",
  TOOLS: "langwatch.code_agent.tools",
  FILES_TOUCHED: "langwatch.code_agent.files_touched",
  SUB_AGENTS: "langwatch.code_agent.sub_agents",
  FAILED_TOOLS: "langwatch.code_agent.failed_tools",
  TRUNCATED: "langwatch.code_agent.truncated",
  STOP_REASON: "langwatch.code_agent.stop_reason",
  SLASH_COMMAND: "langwatch.code_agent.slash_command",
  SKILLS: "langwatch.code_agent.skills",
  SUBAGENT_TYPES: "langwatch.code_agent.subagent_types",
  COMPACTED: "langwatch.code_agent.compacted",
  API_ERRORS: "langwatch.code_agent.api_errors",
  STEPS: "langwatch.code_agent.steps",
} as const;

/** A failed step is stored with a trailing `!` so it reads in sequence. */
const FAILED_STEP_SUFFIX = "!";

/**
 * One thing the agent did, in the order it did it.
 *
 * A RUN of the same tool back-to-back is one step with a count: an agent that
 * reads eight files in a row did one thing eight times, and spelling that out as
 * `Read › Read › Read › …` buries the shape of the interaction under repetition.
 * `Read ×8 › Bash` says the same thing and leaves room for what came next.
 */
export interface CodeAgentStep {
  name: string;
  /** How many times it ran back-to-back. 1 for a single run. */
  count: number;
  /** True when any run in this batch failed. */
  failed: boolean;
}

export interface CodeAgentActivity {
  /**
   * What the agent did, IN ORDER. Counts alone would say "Bash 2, Read 2, Edit 1"
   * and lose the story: it read the files, ran the tests, fixed one, re-ran them.
   * A failed step is marked in place, so a failure reads where it happened rather
   * than being hoisted out of sequence.
   */
  steps: CodeAgentStep[];
  /** False when this trace isn't a coding-agent interaction — render nothing. */
  hasActivity: boolean;
  modelCalls: number;
  toolCalls: number;
  /** Every tool and how often it ran, most-used first. */
  tools: { name: string; count: number }[];
  filesTouched: string[];
  subAgents: number;
  subAgentTypes: string[];
  skills: string[];
  failedTools: number;
  apiErrors: number;
  /** The reply was cut off (or refused) rather than finished. */
  isTruncated: boolean;
  stopReason: string | null;
  /** The context was compacted, so it answered from a summary. */
  wasCompacted: boolean;
  /** The slash command that opened the interaction, if any. */
  slashCommand: string | null;
  /**
   * True when anything went wrong. Note this does NOT reorder anything: a failed
   * step stays in the sequence it happened in, because a command that failed
   * BEFORE an edit means something different from one that failed after. This
   * only drives whether the row carries a warning tone at all.
   */
  hasProblem: boolean;
}

function num(attributes: Record<string, string>, key: string): number {
  const n = Number(attributes[key] ?? "0");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function list(attributes: Record<string, string>, key: string): string[] {
  const raw = attributes[key];
  if (!raw) return [];
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
 * The ordered steps: `[[startedAtMs, "Bash!"], ...]`, with back-to-back runs of
 * the same tool BATCHED into one step with a count.
 *
 * Batching only ever collapses ADJACENT runs, never re-orders or regroups across
 * the sequence — `Read Read Bash Read` stays `Read ×2 › Bash › Read`, because
 * the second visit to Read after a Bash is a different beat of the story (it
 * checked, ran, checked again) and merging it into the first would erase that.
 */
function steps(attributes: Record<string, string>): CodeAgentStep[] {
  const raw = attributes[ATTRS.STEPS];
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const batched: CodeAgentStep[] = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry) || typeof entry[1] !== "string") continue;
    const label: string = entry[1];
    const failed = label.endsWith(FAILED_STEP_SUFFIX);
    const name = failed ? label.slice(0, -1) : label;

    const previous = batched[batched.length - 1];
    if (previous && previous.name === name) {
      previous.count += 1;
      // A batch is failed if ANY run in it failed — a run of five tests where
      // the third broke is not a clean run.
      previous.failed = previous.failed || failed;
      continue;
    }
    batched.push({ name, count: 1, failed });
  }
  return batched;
}

/** `{"Bash":5,"Edit":3}` → most-used first. */
function tools(
  attributes: Record<string, string>,
  key: string,
): { name: string; count: number }[] {
  const raw = attributes[key];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed as Record<string, unknown>)
      .map(([name, count]) => ({ name, count: Number(count) }))
      .filter((t) => Number.isFinite(t.count) && t.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function useCodeAgentActivity(
  attributes: Record<string, string> | undefined,
): CodeAgentActivity {
  return useMemo(() => deriveCodeAgentActivity(attributes), [attributes]);
}

/** @internal Exported so the derivation can be tested without a component. */
export function deriveCodeAgentActivity(
  attributes: Record<string, string> | undefined,
): CodeAgentActivity {
  const attrs = attributes ?? {};

  const modelCalls = num(attrs, ATTRS.MODEL_CALLS);
  const toolCalls = num(attrs, ATTRS.TOOL_CALLS);
  const failedTools = num(attrs, ATTRS.FAILED_TOOLS);
  const apiErrors = num(attrs, ATTRS.API_ERRORS);
  const isTruncated = attrs[ATTRS.TRUNCATED] === "true";
  const wasCompacted = attrs[ATTRS.COMPACTED] === "true";
  const subAgents = num(attrs, ATTRS.SUB_AGENTS);
  const slashCommand = attrs[ATTRS.SLASH_COMMAND] || null;

  return {
    steps: steps(attrs),
    // A trace with no model calls and no tools is not a coding-agent
    // interaction (or predates the fold) — the caller renders nothing.
    hasActivity: modelCalls > 0 || toolCalls > 0,
    modelCalls,
    toolCalls,
    tools: tools(attrs, ATTRS.TOOLS),
    filesTouched: list(attrs, ATTRS.FILES_TOUCHED),
    subAgents,
    subAgentTypes: list(attrs, ATTRS.SUBAGENT_TYPES),
    skills: list(attrs, ATTRS.SKILLS),
    failedTools,
    apiErrors,
    isTruncated,
    stopReason: attrs[ATTRS.STOP_REASON] || null,
    wasCompacted,
    slashCommand,
    hasProblem:
      isTruncated || failedTools > 0 || apiErrors > 0,
  };
}
