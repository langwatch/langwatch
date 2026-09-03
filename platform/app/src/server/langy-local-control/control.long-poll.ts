/**
 * The HTTP fallback for the local control socket (ADR-129).
 *
 * A network that blocks WebSockets still has to carry the folder, so the same
 * three moves are available over plain requests: register once, poll for the
 * frames the platform has for you, and post the frames you have for it. The
 * meaning of each move is `LocalControlSessionCore`'s, exactly as it is for the
 * socket; this file owns only the queue that turns a subscription into a poll.
 *
 * One hold per poll, twenty seconds, so a proxy sees one request every twenty
 * seconds rather than one every half second. That is the number the ADR-128
 * ingress requirement is written against.
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { Unsubscribe } from "~/server/connected-agents/state-store";
import { CALL_POLL_HOLD_MS, POLL_INTERVAL_MS } from "./constants";
import {
  type CliFrame,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type PlatformFrame,
  type RegisterFrame,
} from "./protocol";
import type { ControlSession, LocalControlSessionCore } from "./session.core";

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
  core: LocalControlSessionCore;
  holdMs?: number;
  pollIntervalMs?: number;
}

/**
 * One process's long-poll sessions. A session lives on the pod that registered
 * it: the token is that pod's handle on a subscription, and a poll that lands
 * elsewhere finds nothing and re-registers, which is the same recovery a
 * dropped socket takes.
 */
export class LocalControlLongPoll {
  private readonly core: LocalControlSessionCore;
  private readonly holdMs: number;
  private readonly pollIntervalMs: number;
  private readonly sessions = new Map<
    string,
    {
      session: ControlSession;
      queue: PlatformFrame[];
      unsubscribe: Unsubscribe;
      lastSeenAt: number;
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
    const unsubscribe = await this.core.subscribe(
      registered.session,
      (platformFrame) => {
        if (queue.length >= MAX_FRAMES_PER_POLL) queue.shift();
        queue.push(platformFrame);
      },
    );
    this.sessions.set(token, {
      session: registered.session,
      queue,
      unsubscribe,
      lastSeenAt: Date.now(),
    });

    await this.core.afterRegister(registered.session);
    for (const envelope of await this.core.pendingCalls(registered.session)) {
      queue.push({
        type: "call",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        call: envelope,
      });
    }
    return { ok: true, token, reply: registered.reply };
  }

  /**
   * Holds until there is something to send, then answers with everything that
   * queued. An empty answer is normal: the command line polls again, and the
   * poll doubles as the folder's heartbeat.
   *
   * `inFlightCallIds` are the calls the command line believes it is still
   * running. A call the platform no longer holds is answered with a cancel, so
   * a command line that polled through a restart stops work nobody is waiting
   * for rather than running it to the end.
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

    const until = Date.now() + this.holdMs;
    for (;;) {
      entry.lastSeenAt = Date.now();
      await this.core.heartbeat(entry.session);
      if (entry.queue.length > 0) {
        return { ok: true, frames: entry.queue.splice(0, entry.queue.length) };
      }
      if (Date.now() >= until || signal?.aborted)
        return { ok: true, frames: [] };
      await sleep(this.pollIntervalMs, signal);
    }
  }

  /** A cancel frame for each call the command line holds and the platform does not. */
  private async orphanedCalls(
    inFlightCallIds: string[],
  ): Promise<PlatformFrame[]> {
    const frames: PlatformFrame[] = [];
    for (const callId of inFlightCallIds) {
      const call = await this.core.dispatcher.read(callId);
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
  async frames({
    token,
    frames,
  }: {
    token: string;
    frames: CliFrame[];
  }): Promise<{ ok: boolean }> {
    const entry = this.sessions.get(token);
    if (!entry) return { ok: false };
    entry.lastSeenAt = Date.now();
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
  async retire(
    token: string,
    reason: "cli_exit" | "panel" | "presence_lost",
  ): Promise<void> {
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
  async sweep(now = Date.now()): Promise<void> {
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
