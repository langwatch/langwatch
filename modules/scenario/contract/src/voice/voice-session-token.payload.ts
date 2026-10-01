// Claims a signed voice session token carries between mint and finish: only ids and project scope.
// Signed and verified server-side (@langwatch/scenario-process). Short-lived: call budget + grace.

import { z } from "zod";

import { VOICE_TRANSPORTS, type VoiceTransport } from "./voice-transport.ts";

/** The claims carried in a signed voice session token. */
export interface VoiceSessionTokenPayload {
  /** Our correlation id for the call until the provider assigns one. */
  sessionId: string;
  /** The project the session was minted under; finish must match it. */
  projectId: string;
  /** The saved agent row id, or null when the drawer had not saved one yet
   *  at mint time (finish creates the row in that case). */
  agentId: string | null;
  /** The vendor agent id the session was minted for: read off the row when
   *  one exists, otherwise the mint request's own value for an unsaved
   *  draft. The finished conversation's own agent id must equal this. */
  agentExternalId: string;
  transport: VoiceTransport;
  /** Expiry, ms since epoch. A token is invalid once `now >= exp`. */
  exp: number;
}

export const voiceSessionTokenPayloadSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  agentId: z.string().min(1).nullable(),
  agentExternalId: z.string().min(1),
  transport: z.enum(VOICE_TRANSPORTS),
  exp: z.number(),
});
