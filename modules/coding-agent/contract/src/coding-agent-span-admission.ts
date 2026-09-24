import type { NormalizedSpan } from "@langwatch/trace-contract";

import { detectCodingAgent } from "./telemetry/coding-agent-normalization.ts";
import { CODING_AGENT_REGISTRY } from "./telemetry/index.ts";

/** Claude Code's self-namespaced span names: admitted without asking the scope. */
const SELF_NAMESPACED_SPAN_NAMES: ReadonlySet<string> = new Set([
  "claude_code.llm_request",
  "claude_code.tool",
  "claude_code.tool.execution",
  "claude_code.tool.blocked_on_user",
  "claude_code.subagent.spawn",
]);

const DECLARED_SPAN_NAMES: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.flatMap((agent) => agent.sessionSpanNames ?? []),
);

export interface CodingAgentSessionSpanCandidate {
  name: string;
  scopeName?: string | null;
}

/** Whether a span belongs to a coding-agent session; a bare declared name also asks the scope. */
export function admitsCodingAgentSpan({
  name,
  scopeName,
}: CodingAgentSessionSpanCandidate): boolean {
  if (SELF_NAMESPACED_SPAN_NAMES.has(name)) return true;
  if (!DECLARED_SPAN_NAMES.has(name)) return false;
  return detectCodingAgent({ recordName: name, scopeName }) !== "unknown";
}

/** One received span, normalized by trace, whose session facts coding-agent derives. */
export type CodingAgentReceivedSpan = Readonly<{
  tenantId: string;
  occurredAt: number;
  span: NormalizedSpan;
}>;
