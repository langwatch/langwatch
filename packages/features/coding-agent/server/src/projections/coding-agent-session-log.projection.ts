import {
  EVENTS_FOLD_TOOL_RUNS_AGENT_IDS,
  LOGS_ONLY_AGENT_IDS,
  WRAPPER_TOOL_NAMES_BY_AGENT_ID,
  normalizeEventName,
  SESSION_CONTEXT_ATTR,
  SESSION_CONTEXT_EVENT,
  SESSION_NAME_FACT_KEY,
  SESSION_TITLE_FACT_KEY,
  SESSION_TITLE_FALLBACK_FACT_KEY,
} from "@langwatch/coding-agent-contract";
import {
  type CodingAgentSessionData,
  CodingAgentSessionStateProjection,
} from "./coding-agent-session-state.projection";

const CLAUDE = {
  EVENT: {
    USER_PROMPT: "user_prompt",
    ASSISTANT_RESPONSE: "assistant_response",
    API_REQUEST: "api_request",
    API_RESPONSE: "api_response",
    TOOL_RESULT: "tool_result",
    TOOL_DECISION: "tool_decision",
    API_ERROR: "api_error",
    RETRIES_EXHAUSTED: "retries_exhausted",
    RATE_LIMIT: "rate_limit",
    REFUSAL: "api_refusal",
    COMPACTION: "compaction",
    PERMISSION_MODE: "permission_mode_changed",
    SKILL_ACTIVATED: "skill_activated",
    MCP_CONNECTION: "mcp_server_connection",
    HOOK_COMPLETE: "hook_execution_complete",
    AT_MENTION: "at_mention",
    INTERNAL_ERROR: "internal_error",
  },
} as const;
const CODEX = { EVENT: { TURN_TTFT: "turn_ttft" } } as const;
const LANGWATCH = {
  EVENT: { SESSION_CONTEXT: SESSION_CONTEXT_EVENT },
  ATTR: {
    ...SESSION_CONTEXT_ATTR,
    TITLE: SESSION_TITLE_FACT_KEY,
    TITLE_FALLBACK: SESSION_TITLE_FALLBACK_FACT_KEY,
    NAME: SESSION_NAME_FACT_KEY,
  },
} as const;
const RATE_LIMIT_STATUS = "429";
const ABORTED_SOURCES = new Set(["user_abort"]);

export interface CodingAgentSessionLogProjectionInput {
  state: CodingAgentSessionData;
  attributes: Record<string, unknown>;
  agent?: string;
  occurredAtMs?: number;
}

/** Deterministically projects one normalized log contribution into session state. */
export class CodingAgentSessionLogProjection {
  private constructor(private readonly stateProjection: CodingAgentSessionStateProjection) {}

  static create(deps: {
    stateProjection: CodingAgentSessionStateProjection;
  }): CodingAgentSessionLogProjection {
    return new CodingAgentSessionLogProjection(deps.stateProjection);
  }

  applyLogToCodingAgentSession({
    state,
    attributes,
    agent,
    occurredAtMs,
  }: CodingAgentSessionLogProjectionInput): CodingAgentSessionData {
    const attrs = attributes;
    // Membership rides the registry (`logsOnly` on the definition), so adding
    // an events-only agent touches agents/ only. String-typed at this seam
    // because the contribution schema is a wire string, not the union.
    const isLogsOnly = agent !== undefined && LOGS_ONLY_AGENT_IDS.has(agent);
    // Normalize the agent's spelling into one vocabulary before matching. Claude
    // Code and Codex namespace their event names (`claude_code.tool_result`,
    // `codex.tool_result`); opencode sends a bare `tool_result` and dots its
    // session events (`session.created`). Matching the raw string would have meant
    // three switch statements that drift apart.
    const event = normalizeEventName(this.stateProjection.string(attrs["event.name"]));
    if (event === null) return state;

    const base = this.stateProjection.withIdentity(state, attrs);

    switch (event) {
      case CLAUDE.EVENT.USER_PROMPT: {
        const command = this.stateProjection.string(attrs.command_name);
        return {
          // The first prompt names an unnamed session; the generated title
          // (API_RESPONSE below) and the session's own name replace it.
          ...this.stateProjection.withTitle({
            state: base,
            value: this.stateProjection.string(attrs[LANGWATCH.ATTR.TITLE_FALLBACK]),
            source: "prompt",
          }),
          prompts: base.prompts + 1,
          // The length, never the text.
          promptChars: base.promptChars + this.stateProjection.number(attrs.prompt_length),
          slashCommands:
            command !== null
              ? this.stateProjection.addToBoundedSet(base.slashCommands, command)
              : base.slashCommands,
        };
      }

      case CLAUDE.EVENT.ASSISTANT_RESPONSE:
        return {
          ...base,
          responseChars: base.responseChars + this.stateProjection.number(attrs.response_length),
        };

      case CLAUDE.EVENT.API_REQUEST: {
        // What the agent says it was billed, kept NEXT TO the computed cost
        // rather than as it. The two disagreeing is a signal, not noise: the
        // reported figure caught the registry pricing hour-long cache writes
        // short-lived, and the computed one caught the agent still billing a
        // model at a withdrawn price. Neither is trusted alone.
        const reported = this.stateProjection.number(attrs.cost_usd);
        const withReported = {
          ...base,
          agentReportedCostUsd: base.agentReportedCostUsd + reported,
        };
        // For a logs-only agent this event IS the model call — the same facts
        // the llm_request span carries for Claude Code fold from here instead —
        // and with no token-bearing span to compute from, the reported figure
        // is also the session's cost.
        return isLogsOnly
          ? this.stateProjection.foldModelCall(
              { ...withReported, costUsd: withReported.costUsd + reported },
              attrs,
              0,
            )
          : withReported;
      }

      case CLAUDE.EVENT.API_RESPONSE:
        // The generated conversation title, already parsed out of the response
        // body by the dispatcher. Last non-empty wins within its rank: the
        // agent regenerates the title as the conversation turns, and the
        // newest one describes it — but it never replaces the session's own
        // name.
        return this.stateProjection.withTitle({
          state: base,
          value: this.stateProjection.string(attrs[LANGWATCH.ATTR.TITLE]),
          source: "generated",
        });

      case LANGWATCH.EVENT.SESSION_CONTEXT: {
        // Everything here is present tense, last write wins: a resumed session
        // moves between branches, worktrees and even repositories, and the row
        // answers where it is NOW. Per-branch history lives on the fact rows
        // (the contribute command stamps each one with the context active when
        // it happened), so nothing is lost by letting the scalars move. Every
        // branch the session passed through also joins the set, because a
        // session that moves on has still driven the branch it left, and the
        // pull request it opened there.
        const branch = this.stateProjection.string(attrs[LANGWATCH.ATTR.BRANCH]);
        // Two titles can ride the record. The context title is the codex
        // harvest's prompt-derived name (codex withholds prompt text from its
        // own events), so it fills an empty row only. The session NAME is the
        // one the harness itself holds — claude's --name and /rename, codex's
        // thread name — mirrored by the capture seams: the newest name
        // replaces the title in place and neither derived tier may clobber it.
        const named = this.stateProjection.withTitle({
          state: this.stateProjection.withTitle({
            state: base,
            value: this.stateProjection.string(attrs[LANGWATCH.ATTR.TITLE]),
            source: "prompt",
          }),
          value: this.stateProjection.string(attrs[LANGWATCH.ATTR.NAME]),
          source: "name",
        });
        return {
          ...named,
          repositoryHost:
            this.stateProjection.string(attrs[LANGWATCH.ATTR.REPOSITORY_HOST]) ??
            base.repositoryHost,
          repositoryOwner:
            this.stateProjection.string(attrs[LANGWATCH.ATTR.REPOSITORY_OWNER]) ??
            base.repositoryOwner,
          repositoryName:
            this.stateProjection.string(attrs[LANGWATCH.ATTR.REPOSITORY_NAME]) ??
            base.repositoryName,
          gitWorktree:
            this.stateProjection.string(attrs[LANGWATCH.ATTR.WORKTREE]) ?? base.gitWorktree,
          gitBranch: branch ?? base.gitBranch,
          gitBranches:
            branch !== null
              ? this.stateProjection.addToBoundedSet(base.gitBranches, branch)
              : base.gitBranches,
        };
      }

      case CLAUDE.EVENT.TOOL_RESULT: {
        const errorType = this.stateProjection.string(attrs.error_type);
        const withBytes = {
          ...base,
          // Bytes of tool OUTPUT fed back into the context — the usual cause of a
          // session bloating its way into a compaction.
          toolResultBytes:
            base.toolResultBytes + this.stateProjection.number(attrs.tool_result_size_bytes),
          toolInputBytes:
            base.toolInputBytes + this.stateProjection.number(attrs.tool_input_size_bytes),
          errorTypes:
            errorType !== null && this.stateProjection.scalarString(attrs.success) === "false"
              ? this.stateProjection.incrementCounter(base.errorTypes, errorType)
              : base.errorTypes,
        };
        // A wrapper tool (codex's code-mode `exec`) carries OTHER dispatches:
        // each tool the script inside it invokes re-enters the agent's
        // registry and reports its own result event, so counting the wrapper
        // too would count every carried command twice. Its bytes still fold —
        // it is the run that is declined, not the record.
        const wrapperNames =
          agent !== undefined ? WRAPPER_TOOL_NAMES_BY_AGENT_ID.get(agent) : undefined;
        const wrapped =
          wrapperNames?.has(this.stateProjection.string(attrs.tool_name) ?? "") === true;
        // For an agent whose tool runs live on events — every logs-only agent,
        // and codex, which has no tool span — this event IS the tool run:
        // name, duration, outcome, which span-bearing agents fold from the
        // tool span instead.
        return !wrapped && agent !== undefined && EVENTS_FOLD_TOOL_RUNS_AGENT_IDS.has(agent)
          ? this.stateProjection.foldToolInvocation(withBytes, {
              attrs,
              failed: this.stateProjection.scalarString(attrs.success) === "false",
              toolMs: this.stateProjection.number(attrs.duration_ms),
              startedAtMs: occurredAtMs ?? 0,
            })
          : withBytes;
      }

      case CLAUDE.EVENT.TOOL_DECISION: {
        // Claude spells a refusal `reject`; codex spells it `denied` (and
        // `denied_with_network_policy_deny`). Codex also puts the walk-away on
        // the DECISION itself — `abort`, or `timed_out` for a prompt left to
        // expire — where claude reports it as `reject` + `source: user_abort`.
        const decision = this.stateProjection.string(attrs.decision) ?? "";
        const rejected = decision === "reject" || decision.startsWith("denied");
        const walkedAway =
          decision === "abort" ||
          decision === "timed_out" ||
          ABORTED_SOURCES.has(this.stateProjection.string(attrs.source) ?? "");
        if (!rejected && !walkedAway) return base;
        // An ABORT (the human walked away from the prompt) is a different act from
        // a refusal, and NEITHER is a tool that broke. Counting them as failures
        // would report the human's judgement as the agent's fault.
        return walkedAway
          ? { ...base, toolsAborted: base.toolsAborted + 1 }
          : { ...base, toolsDenied: base.toolsDenied + 1 };
      }

      case CLAUDE.EVENT.API_ERROR:
        return {
          ...base,
          apiErrors: base.apiErrors + 1,
          rateLimited:
            base.rateLimited +
            (this.stateProjection.scalarString(attrs.status_code) === RATE_LIMIT_STATUS ? 1 : 0),
        };

      case CLAUDE.EVENT.RETRIES_EXHAUSTED:
        return {
          ...base,
          retriesExhausted: base.retriesExhausted + 1,
          // Wall-clock burned on attempts that produced nothing.
          retryMs: base.retryMs + this.stateProjection.number(attrs.total_retry_duration_ms),
        };

      case CLAUDE.EVENT.RATE_LIMIT:
        // The agent SAYING it was throttled, kept apart from `rateLimited`
        // (inferred from 429 api_errors): this event also fires on warnings and
        // status updates, so the two counters answer different questions.
        return { ...base, rateLimitEvents: base.rateLimitEvents + 1 };

      case CLAUDE.EVENT.REFUSAL: {
        // A server-side fallback hop already retried on another model, so the user
        // never saw that refusal. Counting it would overstate how often the agent
        // actually refused the human.
        if (this.stateProjection.scalarString(attrs.server_fallback_hop) === "true") return base;
        const category = this.stateProjection.string(attrs.category);
        return {
          ...base,
          refusals: base.refusals + 1,
          refusalCategories:
            category !== null
              ? this.stateProjection.addToBoundedSet(base.refusalCategories, category)
              : base.refusalCategories,
        };
      }

      case CLAUDE.EVENT.COMPACTION:
        return {
          ...base,
          compactions: base.compactions + 1,
          compactionTokensBefore:
            base.compactionTokensBefore + this.stateProjection.number(attrs.pre_tokens),
          compactionTokensAfter:
            base.compactionTokensAfter + this.stateProjection.number(attrs.post_tokens),
          // A manual /compact and an auto-compaction tell different stories
          // about the session; "unknown" is the honest bucket for telemetry
          // that predates the trigger attribute.
          compactionTriggers: this.stateProjection.incrementCounter(
            base.compactionTriggers,
            this.stateProjection.string(attrs.trigger) ?? "unknown",
          ),
        };

      case CLAUDE.EVENT.PERMISSION_MODE: {
        const mode = this.stateProjection.string(attrs.to_mode);
        return {
          ...base,
          permissionMode: mode ?? base.permissionMode,
          // Every widening of what the agent is allowed to do is worth auditing.
          permissionChanges: base.permissionChanges + 1,
        };
      }

      case CLAUDE.EVENT.SKILL_ACTIVATED: {
        const skill = this.stateProjection.string(attrs["skill.name"]);
        return skill !== null
          ? { ...base, skills: this.stateProjection.addToBoundedSet(base.skills, skill) }
          : base;
      }

      case CLAUDE.EVENT.MCP_CONNECTION: {
        const server =
          this.stateProjection.string(attrs.server_name) ??
          this.stateProjection.string(attrs["plugin.name"]);
        return server !== null
          ? { ...base, mcpServers: this.stateProjection.addToBoundedSet(base.mcpServers, server) }
          : base;
      }

      case CLAUDE.EVENT.HOOK_COMPLETE:
        // The safeguards that actually FIRED: a hook that returned a blocking
        // decision stopped the agent doing something.
        return {
          ...base,
          hooksBlocked: base.hooksBlocked + this.stateProjection.number(attrs.num_blocking),
          hooksCancelled: base.hooksCancelled + this.stateProjection.number(attrs.num_cancelled),
          hookMs: base.hookMs + this.stateProjection.number(attrs.total_duration_ms),
        };

      case CLAUDE.EVENT.AT_MENTION:
        return { ...base, atMentions: base.atMentions + 1 };

      case CODEX.EVENT.TURN_TTFT: {
        // Codex reports TTFT as its own event; claude carries it on the
        // llm_request span. Both land in the same sum + count, and a zero is
        // "not measured", never a sample.
        const ttftMs = this.stateProjection.number(attrs.duration_ms);
        return ttftMs > 0
          ? {
              ...base,
              ttftMsTotal: base.ttftMsTotal + ttftMs,
              ttftSamples: base.ttftSamples + 1,
            }
          : base;
      }

      case CLAUDE.EVENT.INTERNAL_ERROR:
        return { ...base, internalErrors: base.internalErrors + 1 };

      default:
        return base;
    }
  }
}
