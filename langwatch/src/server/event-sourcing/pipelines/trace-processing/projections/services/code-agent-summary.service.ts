import type { LogRecordReceivedEventData } from "../../schemas/events";
import { NormalizedStatusCode, type NormalizedSpan } from "../../schemas/spans";

/**
 * What a coding-agent interaction actually DID, folded onto the trace.
 *
 * `ComputedInput` / `ComputedOutput` model a conversation: one thing asked, one
 * thing answered. That fits a chat trace and badly misfits a coding agent. The
 * input genuinely is the user's prompt — but the "output" is only the closing
 * remark. The interaction itself was: read twelve files, run the tests, edit
 * three of them, spawn two sub-agents, get a `rm -rf` denied, spend $0.42. None
 * of that survives into one output string.
 *
 * The fix is not a better string. It is to summarise the WORK alongside the
 * answer — what ran, how much, and what went wrong.
 *
 * ## Why the keys are generic
 *
 * None of these facts are Claude-specific. Codex, OpenCode and Cursor all have a
 * finish reason, slash commands, sub-agents, context compaction and an approval
 * mode. What IS emitter-specific is only where we READ them from — the span and
 * event names. So the attribute namespace is `langwatch.code_agent.*` and Claude
 * Code is simply the first ADAPTER that populates it; a Codex adapter added
 * later writes the same keys, and every consumer (drawer, trace list, analytics)
 * keeps working without knowing which agent produced the trace.
 *
 * They land as ordinary trace-summary attributes, so they stay queryable like
 * any other and need no product-specific table. Counted at write time, so reads
 * pay nothing — a non-coding-agent span costs one name comparison.
 */
export const CODE_AGENT_ATTRS = {
  // ── What the interaction did ──────────────────────────────────────────
  /** Model calls in the loop — 1 is a straight answer, 20 is a long agentic run. */
  MODEL_CALLS: "langwatch.code_agent.model_calls",
  /** Total tool runs. */
  TOOL_CALLS: "langwatch.code_agent.tool_calls",
  /** Which tools, and how often: `{"Bash":5,"Edit":3}`. */
  TOOLS: "langwatch.code_agent.tools",
  /** Distinct files the interaction touched. */
  FILES_TOUCHED: "langwatch.code_agent.files_touched",
  /** How many sub-agents it spawned. */
  SUB_AGENTS: "langwatch.code_agent.sub_agents",
  /** Tool runs that failed. */
  FAILED_TOOLS: "langwatch.code_agent.failed_tools",

  // ── What kind of interaction it was ───────────────────────────────────
  /** end_turn | tool_use | max_tokens | stop_sequence | refusal */
  STOP_REASON: "langwatch.code_agent.stop_reason",
  /** True when the reply was CUT OFF rather than finished. */
  TRUNCATED: "langwatch.code_agent.truncated",
  /** The slash command that opened the interaction — often the real intent. */
  SLASH_COMMAND: "langwatch.code_agent.slash_command",
  /** Which skills ran, e.g. `["code-review"]`. */
  SKILLS: "langwatch.code_agent.skills",
  /** Which sub-agent types ran, e.g. `["Explore"]`. */
  SUBAGENT_TYPES: "langwatch.code_agent.subagent_types",
  /** The context was compacted mid-interaction. */
  COMPACTED: "langwatch.code_agent.compacted",
  /** Model calls that failed (and were retried). */
  API_ERRORS: "langwatch.code_agent.api_errors",
  /** default | plan | acceptEdits | auto | bypassPermissions */
  PERMISSION_MODE: "langwatch.code_agent.permission_mode",
  /** Which interaction this is within its session (1-based). */
  SEQUENCE: "langwatch.code_agent.interaction_sequence",
  /**
   * The steps IN THE ORDER THEY HAPPENED, e.g.
   * `["Read","Read","Bash","Edit!","Bash"]`.
   *
   * Counts tell you an interaction ran five Bash commands. The order tells you
   * it read two files, ran the tests, edited one, and re-ran them — which is the
   * thing a human actually wants to know, and the thing a failure needs in order
   * to make sense (a Bash that failed BEFORE an edit means something different
   * from one that failed after). A trailing `!` marks a step that failed, so the
   * failure shows up where it happened instead of being hoisted out of sequence.
   */
  STEPS: "langwatch.code_agent.steps",
} as const;

/**
 * How many steps we keep in order. Long enough for the shape of almost any
 * interaction to survive; bounded so a runaway loop cannot grow the attribute
 * without limit. Past the cap the counts still tell the true magnitude.
 */
const MAX_STEPS_TRACKED = 60;

/** Marks a step that failed, so a failure reads in the sequence it happened. */
const FAILED_STEP_SUFFIX = "!";

/** A reply that stopped for one of these did NOT finish answering. */
const TRUNCATING_STOP_REASONS = new Set(["max_tokens", "refusal"]);

/** How many distinct file paths we keep. A big refactor touches hundreds. */
const MAX_FILES_TRACKED = 20;

/**
 * The Claude Code adapter — the span and event names it emits. This is the ONLY
 * emitter-specific part; everything above is agent-agnostic. A second adapter
 * (Codex, OpenCode) plugs in here and writes the same attributes.
 */
const CLAUDE = {
  LLM_REQUEST_SPAN: "claude_code.llm_request",
  TOOL_SPAN: "claude_code.tool",
  INTERACTION_SPAN: "claude_code.interaction",
  SUBAGENT_SPAWN_SPAN: "claude_code.subagent.spawn",
} as const;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInt(attributes: Record<string, string>, key: string): number {
  const n = Number(attributes[key] ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function bump(
  attributes: Record<string, string>,
  key: string,
): Record<string, string> {
  return { [key]: String(readInt(attributes, key) + 1) };
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

function readList(attributes: Record<string, string>, key: string): string[] {
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
 * One step in the interaction, kept in the order it happened. Serialized as a
 * compact `[startedAtMs, name]` pair (a failed step's name carries a trailing
 * `!`) so the ordered list stays small enough to live on an attribute.
 */
type SerializedStep = [number, string];

/**
 * Append a step, keeping the list in the order the steps actually HAPPENED.
 *
 * Load-bearing: the fold sees spans in ARRIVAL order, which is not start order —
 * spans are exported in batches and a slow tool's span can land after a later
 * one's. Appending as they fold would silently produce a plausible-looking but
 * wrong sequence, which is worse than no sequence at all. So each step carries
 * its start time and is inserted in position.
 */
function appendStep({
  attributes,
  name,
  startedAtMs,
  failed,
}: {
  attributes: Record<string, string>;
  name: string;
  startedAtMs: number;
  failed: boolean;
}): Record<string, string> {
  const steps = readSteps(attributes);
  if (steps.length >= MAX_STEPS_TRACKED) return {};

  const label = failed ? `${name}${FAILED_STEP_SUFFIX}` : name;
  const step: SerializedStep = [startedAtMs, label];

  // Insert in start-time position. The common case is already-in-order, so this
  // walks a step or two from the end.
  let i = steps.length;
  while (i > 0 && (steps[i - 1]?.[0] ?? 0) > startedAtMs) i--;
  steps.splice(i, 0, step);

  return { [CODE_AGENT_ATTRS.STEPS]: JSON.stringify(steps) };
}

function readSteps(attributes: Record<string, string>): SerializedStep[] {
  const raw = attributes[CODE_AGENT_ATTRS.STEPS];
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SerializedStep =>
        Array.isArray(s) &&
        typeof s[0] === "number" &&
        typeof s[1] === "string",
    );
  } catch {
    return [];
  }
}

/** Add to a JSON string-set attribute, if not already there. */
function addToList(
  attributes: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const list = readList(attributes, key);
  if (list.includes(value)) return {};
  return { [key]: JSON.stringify([...list, value]) };
}

/**
 * Fold one SPAN into the interaction summary. Returns ONLY the attributes that
 * changed, so an ordinary LLM trace costs one name comparison and nothing else.
 */
export function accumulateCodeAgentSummaryFromSpan({
  attributes,
  span,
}: {
  attributes: Record<string, string>;
  span: NormalizedSpan;
}): Record<string, string> {
  if (span.name === CLAUDE.INTERACTION_SPAN) {
    const sequence = str(span.spanAttributes["interaction.sequence"]);
    return sequence !== null ? { [CODE_AGENT_ATTRS.SEQUENCE]: sequence } : {};
  }

  if (span.name === CLAUDE.SUBAGENT_SPAWN_SPAN) {
    return bump(attributes, CODE_AGENT_ATTRS.SUB_AGENTS);
  }

  if (span.name === CLAUDE.LLM_REQUEST_SPAN) {
    const next = bump(attributes, CODE_AGENT_ATTRS.MODEL_CALLS);

    // Only the LAST call's stop_reason is the interaction's: the earlier ones
    // all stop on `tool_use` by definition — that is what drove the loop onward
    // — so taking any but the last would report every agentic interaction as
    // unfinished. Last-write-wins across the fold gives us the final call's.
    const stopReason = str(span.spanAttributes.stop_reason);
    if (stopReason !== null) {
      next[CODE_AGENT_ATTRS.STOP_REASON] = stopReason;
      // A reply cut off by max_tokens (or refused) is not an answer. Without
      // this the trace's "output" reads as though the agent finished.
      next[CODE_AGENT_ATTRS.TRUNCATED] = String(
        TRUNCATING_STOP_REASONS.has(stopReason),
      );
    }
    return next;
  }

  if (span.name !== CLAUDE.TOOL_SPAN) return {};

  const next = bump(attributes, CODE_AGENT_ATTRS.TOOL_CALLS);

  const toolName = str(span.spanAttributes.tool_name);
  if (toolName !== null) {
    const tools = readJsonRecord(attributes, CODE_AGENT_ATTRS.TOOLS);
    tools[toolName] = (tools[toolName] ?? 0) + 1;
    next[CODE_AGENT_ATTRS.TOOLS] = JSON.stringify(tools);

    // Only the MAIN thread's steps go in the sequence. A sub-agent runs its own
    // conversation — it can do twenty reads of its own — and splicing those
    // inline would read as though the main thread did them, destroying the very
    // hierarchy that makes the sequence legible. The sub-agent's work is already
    // represented by the step that SPAWNED it (the Task/Agent tool call), and
    // its detail is one level down, in the drawer.
    //
    // `agent_id` is absent on the main thread and present on every sub-agent
    // span, so it is exactly the discriminator we need.
    const isSubAgentStep = str(span.spanAttributes.agent_id) !== null;
    if (!isSubAgentStep) {
      Object.assign(
        next,
        appendStep({
          attributes,
          name: toolName,
          startedAtMs: span.startTimeUnixMs,
          // The numeric OTLP enum, not the string "error" — see the note in
          // coding-agent-session.derivation.ts. Comparing to a string silently
          // marked every step as successful.
          failed: span.statusCode === NormalizedStatusCode.ERROR,
        }),
      );
    }
  }

  // `file_path` only rides the span when tool details are on; without them we
  // still get the counts, just not the paths.
  const filePath = str(span.spanAttributes.file_path);
  if (filePath !== null) {
    const files = readList(attributes, CODE_AGENT_ATTRS.FILES_TOUCHED);
    if (!files.includes(filePath) && files.length < MAX_FILES_TRACKED) {
      next[CODE_AGENT_ATTRS.FILES_TOUCHED] = JSON.stringify([
        ...files,
        filePath,
      ]);
    }
  }

  const subagentType = str(span.spanAttributes.subagent_type);
  if (subagentType !== null) {
    Object.assign(
      next,
      addToList(attributes, CODE_AGENT_ATTRS.SUBAGENT_TYPES, subagentType),
    );
  }

  // A skill reaches the trace two ways: the `skill_activated` log event, and the
  // Skill TOOL span. A skill the agent invoked proactively arrives on one path,
  // a `/slash` skill on the other — reading only one silently loses half.
  const skillName = str(span.spanAttributes.skill_name);
  if (skillName !== null) {
    Object.assign(
      next,
      addToList(attributes, CODE_AGENT_ATTRS.SKILLS, skillName),
    );
  }

  if (span.statusCode === NormalizedStatusCode.ERROR) {
    Object.assign(next, bump(attributes, CODE_AGENT_ATTRS.FAILED_TOOLS));
  }

  return next;
}

/**
 * Fold one LOG RECORD into the interaction summary.
 *
 * Some facts exist ONLY as logs — no span carries them: the slash command that
 * opened the interaction, a mid-interaction compaction, a model call that failed
 * and was retried (a failed call has no successful span).
 */
export function accumulateCodeAgentSummaryFromLog({
  attributes,
  data,
}: {
  attributes: Record<string, string>;
  data: LogRecordReceivedEventData;
}): Record<string, string> {
  const attrs = data.attributes;
  const eventName = str(attrs["event.name"]);
  if (eventName === null) return {};

  if (eventName === "user_prompt") {
    const command = str(attrs.command_name);
    return command !== null
      ? { [CODE_AGENT_ATTRS.SLASH_COMMAND]: command }
      : {};
  }

  if (eventName === "skill_activated") {
    const skill = str(attrs["skill.name"]);
    return skill !== null
      ? addToList(attributes, CODE_AGENT_ATTRS.SKILLS, skill)
      : {};
  }

  if (eventName === "compaction") {
    return { [CODE_AGENT_ATTRS.COMPACTED]: "true" };
  }

  if (eventName === "api_error") {
    return bump(attributes, CODE_AGENT_ATTRS.API_ERRORS);
  }

  if (eventName === "permission_mode_changed") {
    const mode = str(attrs.to_mode);
    return mode !== null ? { [CODE_AGENT_ATTRS.PERMISSION_MODE]: mode } : {};
  }

  return {};
}
