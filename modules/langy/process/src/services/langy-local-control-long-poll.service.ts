/**
 * HTTP fallback for the local control socket (ADR-129): register, poll,
 * post — same meaning via `LocalControlSessionCoreService`. 20s hold per
 * poll, per the ADR-128 ingress requirement.
 */

import type { SessionKeyHolder, SessionKeyPresented } from "@langwatch/api/rest";
import { generate } from "@langwatch/ksuid";
import {
  CALL_POLL_HOLD_MS,
  POLL_INTERVAL_MS,
  type CliFrame,
  LangyLocalRecordNotFoundError,
  LangySessionKeyInvalidError,
  LangySessionKeyUnboundError,
  LangySessionKeyWrongTypeError,
  type LangyControlRegistered,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type LocalControlRefusedCode,
  type PlatformFrame,
  type RegisterFrame,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { Unsubscribe } from "@langwatch/redis-client/session-state";
import { nowInstant } from "@langwatch/time";

import type { ControlSession } from "../rules/langy-local-session-contract.rules.ts";
import { DeliveredCallsService } from "./langy-local-delivered-calls.service.ts";
import type { LocalControlSessionCoreService } from "./langy-local-session.service.ts";

const logger = createLogger("langwatch:langy:local-control:long-poll");

/** How long a long-poll session survives with no poll and no heartbeat. */
const HTTP_SESSION_TTL_SECONDS = 60;

/** The most frames one poll answers with. */
const MAX_FRAMES_PER_POLL = 50;

export interface LocalControlLongPollOptions {
  core: LocalControlSessionCoreService;
  holdMs?: number;
  pollIntervalMs?: number;
}

type LongPollSession = {
  session: ControlSession;
  queue: PlatformFrame[];
  unsubscribe: Unsubscribe;
  lastSeenAt: number;
  state: {
    /**
     * Set once the platform told this command line the folder is disconnected.
     * A poll after that stops refreshing the record, which is meant to be gone.
     */
    released: boolean;
    delivered: DeliveredCallsService;
  };
};

/**
 * One process's long-poll sessions, keyed by a pod-local token. A poll that
 * lands on another pod finds nothing and re-registers, same as a dropped socket.
 */
export class LocalControlLongPollService {
  private readonly core: LocalControlSessionCoreService;
  private readonly holdMs: number;
  private readonly pollIntervalMs: number;
  private readonly sessions = new Map<string, LongPollSession>();

  static create(options: LocalControlLongPollOptions): LocalControlLongPollService {
    return new LocalControlLongPollService(options);
  }

  private constructor(options: LocalControlLongPollOptions) {
    this.core = options.core;
    this.holdMs = options.holdMs ?? CALL_POLL_HOLD_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  /** Who holds a minted session key, as the session-key door asks; any other key throws. */
  async verifySessionKey({ token, projectId }: SessionKeyPresented): Promise<SessionKeyHolder> {
    const authenticated = await this.core.authenticateKey({ token, projectId });
    if (!authenticated.ok) throw sessionKeyRefusal(authenticated.code);
    return {
      actor: { type: "user", id: authenticated.credential.userId },
      projectId: authenticated.credential.projectId,
    };
  }

  /** Registers a folder over HTTP; a key or conversation the core refuses throws its refusal. */
  async register({
    authorization,
    projectId,
    frame,
  }: {
    authorization: string;
    projectId: string;
    frame: RegisterFrame;
  }): Promise<LangyControlRegistered> {
    const authenticated = await this.core.authenticate({ authorization, projectId });
    if (!authenticated.ok) throw sessionKeyRefusal(authenticated.code);
    const registered = await this.core.register({
      credential: authenticated.credential,
      frame,
    });
    if (!registered.ok) throw new LangySessionKeyUnboundError({ reason: "conversation_gone" });

    const token = `lcs_${generate("langy").toString()}`;
    const queue: PlatformFrame[] = [];
    const state = { released: false, delivered: deliveredWith(registered.inFlightCallIds) };
    const unsubscribe = await this.core.subscribe(registered.session, (platformFrame) => {
      if (platformFrame.type === "disconnect") state.released = true;
      if (!state.delivered.admit(platformFrame)) return;
      if (queue.length >= MAX_FRAMES_PER_POLL) queue.shift();
      queue.push(platformFrame);
    });
    const entry: LongPollSession = {
      session: registered.session,
      queue,
      unsubscribe,
      lastSeenAt: nowInstant().epochMilliseconds,
      state,
    };
    this.sessions.set(token, entry);

    await this.core.afterRegister(registered.session);
    for (const envelope of await this.core.pendingCalls(registered.session)) {
      const callFrame: PlatformFrame = {
        type: "call",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        call: envelope,
      };
      if (state.delivered.admit(callFrame)) queue.push(callFrame);
    }
    return { frame: registered.reply, instanceToken: token };
  }

  /**
   * Holds until there is something to send. An empty answer is normal — the
   * poll doubles as the folder's heartbeat. `inFlightCallIds` are answered
   * with a cancel when the platform no longer holds them.
   */
  async poll({
    instanceToken,
    inFlightCallIds = [],
    signal,
  }: {
    instanceToken: string;
    inFlightCallIds?: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ frames: PlatformFrame[] }> {
    const entry = this.sessions.get(instanceToken);
    if (!entry) throw new LangyLocalRecordNotFoundError();

    const orphaned = await this.orphanedCalls(inFlightCallIds);
    if (orphaned.length > 0) return { frames: orphaned };

    const until = nowInstant().epochMilliseconds + this.holdMs;
    const look = async (): Promise<PlatformFrame[]> => {
      entry.lastSeenAt = nowInstant().epochMilliseconds;
      if (!entry.state.released) await this.core.heartbeat(entry.session);
      return entry.queue.splice(0, entry.queue.length);
    };
    let frames = await look();
    while (frames.length === 0 && nowInstant().epochMilliseconds < until && !signal?.aborted) {
      await sleep(this.pollIntervalMs, signal);
      frames = await look();
    }
    return { frames };
  }

  /** A cancel frame for each call the command line holds and the platform does not. */
  private async orphanedCalls(inFlightCallIds: readonly string[]): Promise<PlatformFrame[]> {
    const frames: PlatformFrame[] = [];
    for (const callId of inFlightCallIds) {
      const lookup = await this.core.dispatcher.read(callId);
      if (lookup.kind === "hit" && lookup.call.state !== "done") continue;
      frames.push({
        type: "cancel",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId,
      });
    }
    return frames;
  }

  /** The frames the command line has for the platform; every one is taken. */
  async frames({
    instanceToken,
    frames,
  }: {
    instanceToken: string;
    frames: CliFrame[];
  }): Promise<{ accepted: number }> {
    const entry = this.sessions.get(instanceToken);
    if (!entry) throw new LangyLocalRecordNotFoundError();
    entry.lastSeenAt = nowInstant().epochMilliseconds;
    // A command line that writes is as alive as one that polls, and a long
    // call means it writes far more often than it polls.
    if (!entry.state.released) await this.core.heartbeat(entry.session);
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
          await this.retire(instanceToken, "cli_exit");
          return { accepted: frames.length };
        case "register":
          break;
      }
    }
    return { accepted: frames.length };
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
    const sessions = Array.from(this.sessions);
    for (const [token, entry] of sessions) {
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
    const sessions = Array.from(this.sessions);
    for (const [token] of sessions) {
      await this.retire(token, "cli_exit");
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timerFinished = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
  timer?.unref();
  if (!signal) return timerFinished;

  const aborted = new Promise<void>((resolve) => {
    onAbort = () => {
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([timerFinished, aborted]);
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

/** The handled refusal for a session key the core would not authenticate. */
function sessionKeyRefusal(code: LocalControlRefusedCode): Error {
  if (code === "key_type_not_allowed") return new LangySessionKeyWrongTypeError();
  if (code === "conversation_mismatch") {
    return new LangySessionKeyUnboundError({ reason: "binding_lapsed" });
  }
  return new LangySessionKeyInvalidError();
}
