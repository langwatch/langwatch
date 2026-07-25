/**
 * Langy worker port — the control plane's HTTP calls to the Go opencode manager
 * that are NOT the turn dispatch itself: a liveness probe (so we can skip minting
 * a session key a live worker would discard) and a fire-and-forget warm (so the
 * opencode spawn overlaps the rest of the turn-start instead of preceding the
 * first token).
 *
 * Extracted from routes/langy.ts so the turn-start orchestration lives in the
 * app layer. Both fail OPEN in the safe direction: a broken probe means "mint as
 * if cold" (the pre-optimisation cost, never a broken turn); a failed warm means
 * a cold start (the status quo). Neither can start or duplicate a turn.
 */

import { createLogger } from "@langwatch/observability";
import { context, propagation, trace } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getLangyDispatchCounter } from "~/server/metrics";

const logger = createLogger("langwatch:langy:worker");
const tracer = getLangWatchTracer("langwatch.langy.chat");

/** The warm is fire-and-forget; don't let it hold a socket open. */
const AGENT_WARM_TIMEOUT_MS = 3_000;
/**
 * The dispatch POST returns only the pre-stream STATUS (202 accepted / 409 busy /
 * 428 credentials / 503 at-capacity) — the turn's output flows out-of-band to the
 * relay, not on this response. The manager does a synchronous Acquire+Claim before
 * answering (so the busy-409 is real), which can cold-spawn opencode, so the budget
 * must cover a cold start with margin. Not a per-token deadline — it closes the
 * moment the status lands.
 */
export const AGENT_DISPATCH_TIMEOUT_MS = 60_000;

/**
 * The pre-stream outcome of a turn dispatch. `accepted` (202) means the worker is
 * driving the turn and pushing frames to the relay. `busy` (409) means another
 * turn holds the conversation's single-stream session. `credentialsRequired` (428)
 * means the worker died after the route's probe and must re-mint (G6). `unavailable`
 * covers 503/at-capacity, transport failures, and any other non-2xx — the
 * heartbeat-aware liveness subscriber is the backstop.
 */
export type LangyDispatchOutcome =
  | "accepted"
  | "busy"
  | "credentialsRequired"
  /**
   * A permanent 4xx: the agent understood the request and refused it as
   * invalid. Retrying replays the same rejection — callers must terminalize
   * the turn instead. (409 and 428 keep their own meanings above.)
   */
  | "rejected"
  | "unavailable";
/**
 * The probe sits in front of EVERY message, so it gets a tight budget. It exists
 * to save a ~70ms mint; spending longer than that waiting for the answer would
 * make it a pessimisation. On timeout we fail open and mint, exactly as before.
 */
const AGENT_PROBE_TIMEOUT_MS = 1_000;
/**
 * Cancel is best-effort and off the turn's critical path — a tight budget so a
 * Stop click never hangs on a wedged manager. The durable stopped terminal is
 * already recorded by the time this fires; this only chases the token burn.
 */
const AGENT_CANCEL_TIMEOUT_MS = 3_000;

export interface LangyWorkerPort {
  /**
   * Ask the manager whether a worker with these capabilities is already running,
   * so we can skip minting a session key it would only discard. FAILS OPEN
   * (returns false → the caller mints), so a probe outage costs the old mint,
   * never a broken turn.
   */
  probe(args: {
    projectId: string;
    actorUserId: string;
    conversationId: string;
    model?: string;
    hasGithubAuth: boolean;
    /** Repository/permission scope of the token a spawn would carry — so a scope
     * change is a probe MISS and the worker re-warms rather than reusing a token
     * scoped to different repos. */
    githubRepoScopeKey?: string;
    egressAllowlist?: string[];
    /** ADR-061 mirror tier — rides the probe (like the egress list) so a tier
     * change is a probe MISS and the worker re-warms rather than mirroring under
     * the tier it booted with. */
    mirrorTier?: string;
  }): Promise<boolean>;

  /**
   * Boot the conversation's worker ahead of the turn (manager `POST /warm`).
   * Never awaited by the turn, never throws. `/warm` acquires a worker but never
   * claims it or posts a message, so it cannot start or duplicate a turn.
   */
  warm(args: {
    projectId: string;
    actorUserId: string;
    conversationId: string;
    credentials: unknown;
    modelOverride?: string;
  }): Promise<void>;

  /**
   * Dispatch a turn to the manager (`POST /worker/{intent}`) and return its
   * pre-stream STATUS only. The manager Claims the worker synchronously (so a busy
   * conversation returns 409 here) and then drives the turn detached, pushing
   * signed frames to the relay — the response body is NOT the turn output and is
   * cancelled immediately. `runToken` is the per-conversation frameauth secret the
   * manager signs those frames with; `userId` scopes their identity.
   */
  dispatch(args: {
    intent: "create" | "revive" | "continue";
    conversationId: string;
    turnId: string;
    projectId: string;
    userId: string;
    runToken: string;
    prompt: string;
    system: string;
    /** Conversation-so-far seed the manager folds into a fresh session's
     * first message only; a warm session ignores it. */
    historySeed?: string;
    credentials: unknown;
    modelOverride?: string;
    resumeToken?: string;
  }): Promise<LangyDispatchOutcome>;

  /**
   * Ask the manager to abandon an in-flight turn (`POST /worker/cancel`) so the
   * model stops generating — the token-burn half of a user Stop (ADR-058).
   * FIRE-AND-FORGET and FAILS OPEN: the durable stopped terminal the control
   * plane already recorded is what makes the stop truthful, so a cancel that
   * never reaches a wedged worker costs wasted tokens, never a wrong turn state.
   * The manager keys the worker by `conversationId` and verifies `turnId` still
   * matches the live turn, so a stale cancel cannot touch a newer turn.
   */
  cancel(args: {
    conversationId: string;
    turnId: string;
    projectId: string;
  }): Promise<void>;
}

/**
 * HTTP implementation over the manager's internal-secret-authenticated endpoints.
 */
export function createLangyWorkerPort(config: {
  agentUrl: string;
  internalSecret: string;
}): LangyWorkerPort {
  const { agentUrl, internalSecret } = config;

  return {
    async probe({
      projectId,
      actorUserId,
      conversationId,
      model,
      hasGithubAuth,
      githubRepoScopeKey,
      egressAllowlist,
      mirrorTier,
    }) {
      try {
        // traceparent rides along (no span of its own — the probe is a single
        // cheap read on the turn's critical path) so the manager's probe
        // handling lands in the same trace as the dispatch that follows.
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalSecret}`,
        };
        propagation.inject(context.active(), headers);
        const response = await fetch(`${agentUrl}/worker/probe`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            projectId,
            actorUserId,
            conversationId,
            // Capability fields, not a pre-computed signature: the manager owns
            // the canonicalisation, and computing it here too would be a second
            // copy of the rule, free to drift until every probe silently missed.
            ...(model ? { model } : {}),
            hasGithubAuth,
            ...(githubRepoScopeKey ? { githubRepoScopeKey } : {}),
            ...(egressAllowlist?.length ? { egressAllowlist } : {}),
            ...(mirrorTier ? { mirrorTier } : {}),
          }),
          signal: AbortSignal.timeout(AGENT_PROBE_TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { alive?: unknown };
        const alive = body.alive === true;
        trace.getActiveSpan()?.setAttribute("langy.probe.hit", alive);
        return alive;
      } catch (error) {
        logger.debug(
          { error, conversationId },
          "langy worker probe failed — minting a session key as if cold",
        );
        return false;
      }
    },

    async warm({
      projectId,
      actorUserId,
      conversationId,
      credentials,
      modelOverride,
    }) {
      // Its own span, the one worth staring at: the warm is fire-and-forget, so
      // the only way to know whether the boot actually hides behind the rest of
      // the turn is to see this span overlap the ones that follow it. traceparent
      // is injected so the manager's spawn/boot spans attach to THIS trace.
      await tracer.withActiveSpan(
        "langy.chat.warm_worker",
        {
          attributes: {
            "tenant.id": projectId,
            "user.id": actorUserId,
            "langy.conversation.id": conversationId,
          },
        },
        async () => {
          try {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              Authorization: `Bearer ${internalSecret}`,
            };
            propagation.inject(context.active(), headers);

            const response = await fetch(`${agentUrl}/warm`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                projectId,
                actorUserId,
                conversationId,
                credentials,
                ...(modelOverride ? { modelOverride } : {}),
              }),
              signal: AbortSignal.timeout(AGENT_WARM_TIMEOUT_MS),
            });
            void response.body?.cancel();
          } catch (error) {
            // A cold start is the status quo, not a failure. Debug on purpose.
            logger.debug(
              { error, conversationId },
              "langy worker warm failed — cold-starting",
            );
          }
        },
      );
    },

    async dispatch({
      intent,
      conversationId,
      turnId,
      projectId,
      userId,
      runToken,
      prompt,
      system,
      historySeed,
      credentials,
      modelOverride,
      resumeToken,
    }) {
      return tracer.withActiveSpan(
        "langy.chat.dispatch_turn",
        {
          attributes: {
            "tenant.id": projectId,
            "user.id": userId,
            "langy.conversation.id": conversationId,
            "langy.turn.id": turnId,
            "langy.worker.intent": intent,
          },
        },
        async (span): Promise<LangyDispatchOutcome> => {
          try {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              Authorization: `Bearer ${internalSecret}`,
            };
            propagation.inject(context.active(), headers);

            const response = await fetch(`${agentUrl}/worker/${intent}`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                conversationId,
                // turnId + projectId ride the payload so the manager can echo them
                // on its durable final; runToken + userId let it sign the frames it
                // pushes to the relay.
                turnId,
                projectId,
                userId,
                runToken,
                prompt,
                system,
                // The seed a fresh session's first message is folded from; a
                // warm session ignores it (the manager decides, it owns the
                // session-freshness ground truth).
                ...(historySeed ? { historySeed } : {}),
                credentials,
                ...(modelOverride ? { modelOverride } : {}),
                // ADR-048: resume from a prior turn's checkpoint if one is pending.
                ...(resumeToken ? { resumeToken } : {}),
              }),
              signal: AbortSignal.timeout(AGENT_DISPATCH_TIMEOUT_MS),
            });
            // Fire-and-forget output: the worker streams the turn to the relay, not
            // on this response — read the status, drop the body.
            void response.body?.cancel();
            const outcome: LangyDispatchOutcome =
              response.status === 202 || response.ok
                ? "accepted"
                : response.status === 409
                  ? "busy"
                  : response.status === 428
                    ? "credentialsRequired"
                    : // Only the statuses that mean "the agent understood this
                      // request and refused it as invalid" are permanent. A
                      // 401 mid secret-rotation, a proxy 404, a 408 — all
                      // transient, all must stay retryable, or a rolling
                      // deploy terminalizes healthy turns.
                      response.status === 400 || response.status === 422
                      ? "rejected"
                      : "unavailable";
            span.setAttribute("langy.dispatch.outcome", outcome);
            getLangyDispatchCounter(
              outcome === "credentialsRequired"
                ? "credentials_required"
                : outcome,
            ).inc();
            return outcome;
          } catch (error) {
            logger.warn(
              { error, conversationId, turnId },
              "langy worker dispatch failed — leaving the turn to the liveness subscriber",
            );
            span.setAttribute("langy.dispatch.outcome", "error");
            getLangyDispatchCounter("error").inc();
            return "unavailable";
          }
        },
      );
    },

    async cancel({ conversationId, turnId, projectId }) {
      await tracer.withActiveSpan(
        "langy.chat.cancel_turn",
        {
          attributes: {
            "tenant.id": projectId,
            "langy.conversation.id": conversationId,
            "langy.turn.id": turnId,
          },
        },
        async () => {
          try {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              Authorization: `Bearer ${internalSecret}`,
            };
            propagation.inject(context.active(), headers);

            const response = await fetch(`${agentUrl}/worker/cancel`, {
              method: "POST",
              headers,
              body: JSON.stringify({ conversationId, turnId, projectId }),
              signal: AbortSignal.timeout(AGENT_CANCEL_TIMEOUT_MS),
            });
            void response.body?.cancel();
          } catch (error) {
            // The stop is already truthful (durable stopped terminal + stream
            // end); a cancel that cannot reach the worker only leaves it burning
            // tokens until it finishes on its own. Debug, never surface.
            logger.debug(
              { error, conversationId, turnId },
              "langy worker cancel failed — the turn is already stopped on record",
            );
          }
        },
      );
    },
  };
}
