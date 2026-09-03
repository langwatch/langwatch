/**
 * Writes the address the rest of the product already uses to open the agent
 * editor drawer (`agent-platform-url.ts`, Langy's deep links, `openDrawer`)
 * — same params, same clearing of every other `drawer.*` key.
 */

import type { AgentEditorDrawer } from "@langwatch/agent-web/screens/agent-management";
import { DRAWER_OPEN_PARAM } from "../../drawers";

/** The parameter an editor drawer reads the agent's id from. */
export const DRAWER_AGENT_ID_PARAM = "drawer.agentId";

export function openAgentEditor({
  query,
  drawer,
  agentId,
  setQuery,
}: {
  query: Readonly<Record<string, string | undefined>>;
  drawer: AgentEditorDrawer;
  agentId?: string;
  setQuery: (next: Readonly<Record<string, string | undefined>>) => void;
}): void {
  openAgentDrawer({ query, drawer, agentId, setQuery });
}

/** The same address, opening the read-only connected-agent detail drawer. */
export function openConnectedAgentDrawer({
  query,
  agentId,
  setQuery,
}: {
  query: Readonly<Record<string, string | undefined>>;
  agentId: string;
  setQuery: (next: Readonly<Record<string, string | undefined>>) => void;
}): void {
  openAgentDrawer({ query, drawer: "agentConnectedDetail", agentId, setQuery });
}

function openAgentDrawer({
  query,
  drawer,
  agentId,
  setQuery,
}: {
  query: Readonly<Record<string, string | undefined>>;
  drawer: AgentEditorDrawer | "agentConnectedDetail";
  agentId?: string;
  setQuery: (next: Readonly<Record<string, string | undefined>>) => void;
}): void {
  // Every other `drawer.*` key is dropped, exactly as `openDrawer` does:
  // leaving a previous drawer's parameters behind is what makes an editor
  // open on the agent the reader looked at before this one.
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("drawer.")) next[key] = value;
  }
  next[DRAWER_OPEN_PARAM] = drawer;
  if (agentId) next[DRAWER_AGENT_ID_PARAM] = agentId;
  setQuery(next);
}
