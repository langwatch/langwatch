/**
 * The address that opens the application's registered agent editor drawer.
 *
 * `openAgentEditor` IS THE ONE PIECE OF PLATFORM VOCABULARY THIS FAMILY KEEPS.
 * The code, HTTP and workflow editors are registered drawers, still opened by
 * the scenario editor, the experiments workbench, the agent-testing dialog and
 * the Agent list drawer, and their closures reach the optimization studio. So
 * the screen names the drawer and this writes the address the rest of the
 * product already produces for an agent — the same `?drawer.open=…&drawer.agentId=…`
 * that `agent-platform-url.ts` and Langy's deep links emit, and the same params
 * `openDrawer` writes, including its clearing of every other `drawer.*` key.
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
