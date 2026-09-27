import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const AGENT_SANDBOX_KEY_REAP_PROCESS_NAME = "agentSandboxKeyReap";

/**
 * Hourly. A sandbox key carries its own `expiresAt`, and verification
 * (`ApiKeyApi.findVerifiedToken`) already refuses an elapsed one — a
 * reaped key was inert; this only clears the tail of live-looking rows.
 */
export const AGENT_SANDBOX_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

export const agentSandboxKeyReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export const agentSandboxKeyReapStateSchema = z.object({
  lastReapAt: z.number().nullable(),
});
export type AgentSandboxKeyReapState = z.infer<typeof agentSandboxKeyReapStateSchema>;

export const AGENT_SANDBOX_KEY_REAP_INITIAL_STATE: AgentSandboxKeyReapState = {
  lastReapAt: null,
};

export type AgentSandboxKeyReapIntents = {
  reap: IntentSpec<typeof agentSandboxKeyReapSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The revoke itself is an intent, so it runs behind the outbox lease.
 */
export const agentSandboxKeyReapWake: WakeHandler<
  AgentSandboxKeyReapState,
  AgentSandboxKeyReapIntents
> = (_state, ctx) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intent("reap", `reap:${ctx.at}`, { scheduledFor: ctx.at })],
});
