/**
 * HTTP fallback for the local control socket (ADR-129): register, poll,
 * post — same meaning via `LocalControlSessionCoreService`. 20s hold per
 * poll, per the ADR-128 ingress requirement.
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { Unsubscribe } from "@langwatch/agent-contract";
import { CALL_POLL_HOLD_MS, POLL_INTERVAL_MS } from "@langwatch/langy-contract";
import { DeliveredCallsService } from "../../services/langy-local-delivered-calls.service.ts";
import {
  type CliFrame,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type PlatformFrame,
  type RegisterFrame,
} from "@langwatch/langy-contract";
import type { LocalControlSessionCoreService } from "../../services/langy-local-session.service.ts";
import type { ControlSession } from "../../rules/langy-local-session-contract.rules.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:langy:local-control:long-poll");

/** How long a long-poll session survives with no poll and no heartbeat. */
const HTTP_SESSION_TTL_SECONDS = 60;

/** The most frames one poll answers with. */
const MAX_FRAMES_PER_POLL = 50;

export interface LongPollRegisterOutcome {
  ok: boolean;
  /** The token every later poll and post carries. */
  token?: string;
  reply?: PlatformFrame;
  code?: string;
  message?: string;
}

export interface LocalControlLongPollOptions {
  core: LocalControlSessionCoreService;
  holdMs?: number;
  pollIntervalMs?: number;
}

/**
 * One process's long-poll sessions, keyed by a pod-local token. A poll that
 * lands on another pod finds nothing and re-registers, same as a dropped socket.
 */
export class LocalControlLongPoll {
  private readonly core: LocalControlSessionCoreService;
  private readonly holdMs: number;
  private readonly pollIntervalMs: number;
  private readonly sessions = new Map<
    string,
    {
      session: ControlSession;
      queue: PlatformFrame[];
      unsubscribe: Unsubscribe;
      lastSeenAt: number;
      /**
       * Set once the platform told this command line the folder is
       * disconnected. A poll after that stops refreshing the record, which is
       * meant to be gone.
       */
      released: boolean;
    }
  >();

  constructor(options: LocalControlLongPollOptions) {
    this.core = options.core;
    this.holdMs = options.holdMs ?? CALL_POLL_HOLD_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  /** Registers a folder over HTTP and hands back the token its polls carry. */
  async register({
    authorization,
    projectId,
    frame,
  }: {
    authorization?: string;
    projectId?: string;
    frame: RegisterFrame;
  }): Promise<LongPollRegisterOutcome> {
    const authenticated = await this.core.authenticate({
      ...(authorization ? { authorization } : {}),
      ...(projectId ? { projectId } : {}),
    });
    if (!authenticated.ok) {
      return {
        ok: false,
        code: authenticated.code,
        message: authenticated.message,
      };
    }
    const registered = await this.core.register({
      credential: authenticated.credential,
      frame,
    });
    if (!registered.ok) {
      return { ok: false, code: registered.code, message: registered.message };
    }

    const token = `lcs_${nanoid(24)}`;
    const queue: PlatformFrame[] = [];
    const entry = {
      session: registered.session,
      queue,
      unsubscribe: (async () => undefined) as Unsubscribe,
      lastSeenAt: nowInstant().epochMilliseconds,
      released: false,
      delivered: deliveredWith(registered.inFlightCallIds),
    };
    entry.unsubscribe = await this.core.subscribe(registered.session, (platformFrame) => {
      if (platformFrame.type === "disconnect") entry.released = true;
      if (!entry.delivered.admit(platformFrame)) return;
      if (queue.length >= MAX_FRAMES_PER_POLL) queue.shift();
      queue.push(platformFrame);
    });
    this.sessions.set(token, entry);

    await this.core.afterRegister(registered.session);
    for (const envelope of await this.core.pendingCalls(registered.session)) {
      const callFrame: PlatformFrame = {
        type: "call",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        call: envelope,
      };
      if (entry.delivered.admit(callFrame)) queue.push(callFrame);
    }
    return { ok: true, token, reply: registered.reply };
  }

  /**
   * Holds until there is something to send. An empty answer is normal — the
   * poll doubles as the folder's heartbeat. `inFlightCallIds` are answered
   * with a cancel when the platform no longer holds them.
   */
  async poll({
    token,
    inFlightCallIds = [],
    signal,
  }: {
    token: string;
    inFlightCallIds?: string[];
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; frames: PlatformFrame[] }> {
    const entry = this.sessions.get(token);
    if (!entry) return { ok: false, frames: [] };

    const orphaned = await this.orphanedCalls(inFlightCallIds);
    if (orphaned.length > 0) return { ok: true, frames: orphaned };

    const until = nowInstant().epochMilliseconds + this.holdMs;
    for (;;) {
      entry.lastSeenAt = nowInstant().epochMilliseconds;
      if (!entry.released) await this.core.heartbeat(entry.session);
      if (entry.queue.length > 0) {
        return { ok: true, frames: entry.queue.splice(0, entry.queue.length) };
      }
      if (nowInstant().epochMilliseconds >= until || signal?.aborted)
        return { ok: true, frames: [] };
      await sleep(this.pollIntervalMs, signal);
    }
  }

  /** A cancel frame for each call the command line holds and the platform does not. */
  private async orphanedCalls(inFlightCallIds: string[]): Promise<PlatformFrame[]> {
    const frames: PlatformFrame[] = [];
    for (const callId of inFlightCallIds) {
      const call = await this.core.dispatcher.tryRead(callId);
      if (call && call.state !== "done") continue;
      frames.push({
        type: "cancel",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId,
      });
    }
    return frames;
  }

  /** The frames the command line has for the platform. */
  async frames({ token, frames }: { token: string; frames: CliFrame[] }): Promise<{ ok: boolean }> {
    const entry = this.sessions.get(token);
    if (!entry) return { ok: false };
    entry.lastSeenAt = nowInstant().epochMilliseconds;
    // A command line that writes is as alive as one that polls, and a long
    // call means it writes far more often than it polls.
    if (!entry.released) await this.core.heartbeat(entry.session);
    for (const frame of frames) {
      switch (frame.type) {
        case "ack":
          await this.core.ack(entry.session, frame.callId);
          break;
        case "result":
          await this.core.result(entry.session, frame);
          break;
        case "permission_required":
          await this.core.permissionRequired(entry.session, frame);
          break;
        case "permission_answered":
          await this.core.permissionAnswered(entry.session, frame);
          break;
        case "deregister":
          await this.retire(token, "cli_exit");
          return { ok: true };
        case "register":
          break;
      }
    }
    return { ok: true };
  }

  /** Drops one session and everything it holds. */
  async retire(token: string, reason: "cli_exit" | "panel" | "presence_lost"): Promise<void> {
    const entry = this.sessions.get(token);
    if (!entry) return;
    this.sessions.delete(token);
    await entry.unsubscribe();
    await this.core.retire(entry.session, reason);
  }

  /**
   * Drops the sessions nobody polled for a minute. Presence would expire on
   * its own, but the subscription would not, so a command line that was killed
   * mid-poll would leave one open on this pod.
   */
  async sweep(now = nowInstant().epochMilliseconds): Promise<void> {
    for (const [token, entry] of [...this.sessions]) {
      if (now - entry.lastSeenAt < HTTP_SESSION_TTL_SECONDS * 1000) continue;
      logger.info(
        { conversationId: entry.session.conversationId },
        "long-poll session went quiet, retiring it",
      );
      await this.retire(token, "presence_lost");
    }
  }

  /** Closes every session this pod holds. */
  async close(): Promise<void> {
    for (const [token] of [...this.sessions]) {
      await this.retire(token, "cli_exit");
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * A delivered set that already holds what the command line says it is
 * running, so a reconnect never starts a second copy of a call in flight.
 */
function deliveredWith(inFlightCallIds: readonly string[]): DeliveredCallsService {
  const delivered = DeliveredCallsService.create();
  for (const callId of inFlightCallIds) delivered.reserve(callId);
  return delivered;
}
