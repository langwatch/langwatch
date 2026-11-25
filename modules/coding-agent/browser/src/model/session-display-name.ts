import { isUsableSessionTitle } from "@langwatch/coding-agent-contract";

import { assistantKindOfAgent } from "./assistant-identity.ts";
import { ASSISTANT_PRESETS } from "./assistant-presets.ts";
import { formatShortDate } from "./short-date.ts";

export interface SessionDisplayName {
  text: string;
  /** True when the session carries no usable name and the text was composed from its facts. */
  isFallback: boolean;
}

/** The session's own name, or its agent and start day when it has none a person would recognise. */
export function sessionDisplayName({
  title,
  agent,
  startedAtMs,
}: {
  title: string | null;
  agent: string;
  startedAtMs: number;
}): SessionDisplayName {
  if (isUsableSessionTitle(title)) return { text: title.trim(), isFallback: false };
  const day = formatShortDate({ timestampMs: startedAtMs });
  const text = [`${agentLabel(agent)} session`, day].filter((part) => part !== "").join(" · ");
  return { text, isFallback: true };
}

function agentLabel(agent: string): string {
  const kind = assistantKindOfAgent(agent);
  if (kind !== null) return ASSISTANT_PRESETS[kind].label;
  return agent.trim() === "" ? "Coding agent" : agent.trim();
}
