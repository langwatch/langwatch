import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";

/**
 * Claude Code turns are not a clean back-and-forth.
 *
 * A turn can spawn SUB-AGENTS (the Agent/Task tool), each of which runs its own
 * independent conversation — its own model calls, its own tools, its own rolling
 * message history — concurrently with the main thread and with each other. So a
 * trace is not one transcript; it is a TREE of transcripts.
 *
 * Claude gives us everything needed to reconstruct that tree, and we should use
 * it rather than guess:
 *
 * - Every `llm_request` / `tool` span carries `agent_id` (absent on the main
 *   thread) and `parent_agent_id`.
 * - A dedicated `claude_code.subagent.spawn` span carries
 *   `{agent_id, agent_type, parent_agent_id}`.
 * - OTel parent/child already ties the spawn span to the exact tool call that
 *   made it, so `parent_tool_use_id` (which Claude keeps to its streaming-JSON
 *   protocol and does NOT put on spans) is not needed.
 *
 * The load-bearing consequence: "the final model call carries the whole rolling
 * history" is true PER AGENT, not per trace. Reading the last `llm_request` in a
 * trace that spawned sub-agents can hand you a sub-agent's transcript and pass
 * it off as the turn.
 */
const SUBAGENT_SPAWN_SPAN = "claude_code.subagent.spawn";

export interface AgentSession {
  /** Null for the main thread. */
  agentId: string | null;
  /** e.g. "Explore", "general-purpose" — the sub-agent's type, when named. */
  agentType: string | null;
  /** The span of the tool call that spawned this agent; null for the main thread. */
  spawnedBySpanId: string | null;
  /** Every span belonging to this agent, in start order. */
  spans: SpanDetail[];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function agentIdOf(span: SpanDetail): string | null {
  return str((span.params ?? {}).agent_id);
}

/**
 * Split a trace's spans into the main thread and one session per sub-agent.
 *
 * The main thread is the spans with no `agent_id`. Each sub-agent's session is
 * keyed by its `agent_id` and linked back to the tool call that spawned it via
 * the `subagent.spawn` span's parent — so the UI can show a sub-agent nested
 * under the `Agent(...)` call that started it, which is where it belongs.
 */
export function groupSpansByAgent(spans: SpanDetail[]): {
  main: AgentSession;
  subAgents: AgentSession[];
} {
  const byStart = spans
    .slice()
    .sort((a, b) => a.startTimeMs - b.startTimeMs);

  // What each agent is, and which tool call spawned it.
  const spawnByAgentId = new Map<
    string,
    { agentType: string | null; spawnedBySpanId: string | null }
  >();
  for (const span of byStart) {
    if (span.name !== SUBAGENT_SPAWN_SPAN) continue;
    const params = span.params ?? {};
    const agentId = str(params.agent_id);
    if (agentId === null) continue;
    spawnByAgentId.set(agentId, {
      agentType: str(params.agent_type) ?? str(params.subagent_type),
      // The spawn span is created inside the Agent/Task tool span's context, so
      // its parent IS the tool call that spawned the agent.
      spawnedBySpanId: span.parentSpanId,
    });
  }

  const mainSpans: SpanDetail[] = [];
  const byAgentId = new Map<string, SpanDetail[]>();
  for (const span of byStart) {
    if (span.name === SUBAGENT_SPAWN_SPAN) continue;
    const agentId = agentIdOf(span);
    if (agentId === null) {
      mainSpans.push(span);
      continue;
    }
    const existing = byAgentId.get(agentId);
    if (existing) existing.push(span);
    else byAgentId.set(agentId, [span]);
  }

  const subAgents: AgentSession[] = [];
  for (const [agentId, agentSpans] of byAgentId) {
    const spawn = spawnByAgentId.get(agentId);
    subAgents.push({
      agentId,
      agentType: spawn?.agentType ?? null,
      spawnedBySpanId: spawn?.spawnedBySpanId ?? null,
      spans: agentSpans,
    });
  }

  return {
    main: {
      agentId: null,
      agentType: null,
      spawnedBySpanId: null,
      spans: mainSpans,
    },
    subAgents,
  };
}

/** Sub-agent sessions, keyed by the span of the tool call that spawned them. */
export function indexSubAgentsBySpawningSpan(
  subAgents: AgentSession[],
): Map<string, AgentSession[]> {
  const bySpanId = new Map<string, AgentSession[]>();
  for (const agent of subAgents) {
    if (agent.spawnedBySpanId === null) continue;
    const existing = bySpanId.get(agent.spawnedBySpanId);
    if (existing) existing.push(agent);
    else bySpanId.set(agent.spawnedBySpanId, [agent]);
  }
  return bySpanId;
}
