import type { VoiceTransport } from "@langwatch/scenario-contract";

import type { VoiceSessionClient } from "./voice-call.ts";

/** Shown instead of the call controls for a transport with no browser client. */
export const PHONE_NO_BROWSER_CALL_NOTICE =
  "This agent is reached by phone. Call it from a scenario run; browser calls are not available for phone targets.";

export interface TalkToItPanelProps {
  /** The voice-session doors, each consumer wiring its own contract-derived client. */
  sessionClient: VoiceSessionClient;
  projectId: string;
  projectSlug: string;
  transport: VoiceTransport;
  /** The transport's agent id from the form (never a database id). */
  agentId: string;
  /** The saved agent row id, when the drawer already has one. */
  agentRowId?: string;
  /** The agent name from the form, used to auto-create the row on hang-up. */
  name?: string;
  /** Told the row id when the call created the agent, so the drawer adopts it. */
  onAgentCreated?: (agentRowId: string) => void;
  /** The scenario a "Call it myself" run is scored under (AC23); absent for a drawer call. */
  scenarioId?: string;
}
