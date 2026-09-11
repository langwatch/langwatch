/**
 * The child -> parent Twilio stream-nonce registration handshake.
 *
 * The scenario child process runs the phone transport and is the one that
 * mints the per-call Twilio media-stream nonce (it drives `placeCall`,
 * {@link ../transports/phone.transport}). But the parent worker process owns
 * the public media listener and the registry it authenticates against
 * ({@link ./voice-nonce-registry}, read by
 * {@link ../../workers/voice-ws-listener}) — the process Twilio's dial-back
 * actually reaches. So before the child may dial, it tells the parent the
 * nonce over the process IPC channel and waits for an acknowledgement that
 * the parent has registered it against this child. Only then may `placeCall`
 * proceed: dialling before registration risks Twilio's socket arriving before
 * the parent knows the nonce, which the listener would refuse with 403 —
 * exactly the production gap this module closes.
 *
 * Mirrors the message-shape convention in {@link ../voice-socket-handoff}: a
 * type constant per message, a type guard, and a typed interface. That module
 * moves the socket itself (parent -> child, after the upgrade); this one
 * moves only the nonce (child -> parent, before the dial) and its ack.
 */

import type { ChildProcess } from "node:child_process";

/** Discriminates the child's registration request from other IPC messages. */
export const VOICE_NONCE_REGISTER_MESSAGE = "voice:register-nonce" as const;

/** Discriminates the parent's ack from other IPC messages. */
export const VOICE_NONCE_REGISTER_ACK_MESSAGE =
  "voice:register-nonce-ack" as const;

/** Child -> parent: register `nonce` against the sending child. */
export interface VoiceNonceRegisterMessage {
  type: typeof VOICE_NONCE_REGISTER_MESSAGE;
  /** Correlates the ack to this request; a child may have several in flight
   *  only in theory (one nonce per dial), but the id keeps a stray/duplicate
   *  ack from resolving the wrong wait. */
  requestId: string;
  nonce: string;
}

/** Parent -> child: the outcome of one registration request. */
export interface VoiceNonceRegisterAckMessage {
  type: typeof VOICE_NONCE_REGISTER_ACK_MESSAGE;
  requestId: string;
  ok: boolean;
  /** Present only when `ok` is false, e.g. no listener booted in this
   *  process. Customer-safe is not a concern here — this never reaches a
   *  browser, only the child's own error message. */
  error?: string;
}

/** Narrows an arbitrary IPC message to the nonce registration request. */
export function isVoiceNonceRegisterMessage(
  message: unknown,
): message is VoiceNonceRegisterMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === VOICE_NONCE_REGISTER_MESSAGE
  );
}

/** Discriminates the parent's upgrade-refusal notice from other IPC messages. */
export const VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE =
  "voice:media-upgrade-refused" as const;

/**
 * Parent -> child: the listener refused Twilio's dial-back for a nonce this
 * child registered (currently sent only for an EXPIRED nonce — an unknown
 * nonce has no associated child to notify). Lets the child fail its dial
 * fast with the real cause instead of silently burning the SDK's full
 * connect-wait timeout and reporting a misleading "stream never connected".
 * Best-effort: if this never arrives (process died, message lost), the
 * child still eventually times out on its own — this only shortens the
 * common case, it is not required for correctness.
 */
export interface VoiceMediaUpgradeRefusedMessage {
  type: typeof VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE;
  /** Human-readable cause, e.g. "nonce expired". Never customer-facing —
   *  this dies inside the run's own error message, same as every other
   *  reason string in this module. */
  reason: string;
}

/** Narrows an arbitrary IPC message to the upgrade-refusal notice. */
export function isVoiceMediaUpgradeRefusedMessage(
  message: unknown,
): message is VoiceMediaUpgradeRefusedMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE
  );
}

/** Narrows an arbitrary IPC message to the nonce registration ack. */
export function isVoiceNonceRegisterAckMessage(
  message: unknown,
): message is VoiceNonceRegisterAckMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === VOICE_NONCE_REGISTER_ACK_MESSAGE
  );
}

/** IPC-bearing subset of `process` the child side needs; eases testing (a
 *  fake stands in for the real `process` and its IPC channel). */
export interface VoiceNonceRegisterProcess {
  send?(message: unknown, callback?: (error: Error | null) => void): boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
}

/** How long the child waits for the parent's ack before giving up. Well
 *  under the nonce's own TTL ({@link VOICE_NONCE_DEFAULT_TTL_MS}) — a healthy
 *  parent acks within milliseconds; a slow parent is a bad enough sign that
 *  failing the dial fast is better than gambling the remainder of the TTL
 *  budget on a socket that hasn't even been registered yet. */
export const VOICE_NONCE_REGISTER_TIMEOUT_MS = 5_000;

/** Thrown when the parent never acknowledges within the timeout. */
export class VoiceNonceRegistrationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Parent did not acknowledge the Twilio stream nonce within ${timeoutMs}ms; ` +
        "refusing to dial a call whose media socket the listener cannot yet authenticate.",
    );
    this.name = "VoiceNonceRegistrationTimeoutError";
  }
}

/** Thrown when the parent explicitly reports the registration failed. */
export class VoiceNonceRegistrationFailedError extends Error {
  constructor(reason: string) {
    super(`Parent refused to register the Twilio stream nonce: ${reason}`);
    this.name = "VoiceNonceRegistrationFailedError";
  }
}

/** Thrown when the child has no IPC channel to its parent at all — a spawn
 *  wiring bug (the parent must include "ipc" in the child's stdio). */
export class VoiceNonceRegistrationNoChannelError extends Error {
  constructor() {
    super(
      "No IPC channel to the parent process; cannot register the Twilio " +
        "stream nonce before dialling. The parent must spawn this child with " +
        'an "ipc" stdio channel.',
    );
    this.name = "VoiceNonceRegistrationNoChannelError";
  }
}

/**
 * Parent side: handle one child's registration request — register the nonce
 * with `registry` against `child`, and build the ack the caller sends back.
 * Pure apart from the registry mutation, so it is unit-testable without a
 * real spawned child process or IPC channel; the caller (scenario.processor.ts)
 * owns actually calling `child.send(ack)`.
 */
export function handleVoiceNonceRegisterMessage(params: {
  message: VoiceNonceRegisterMessage;
  child: ChildProcess;
  registry: { register(p: { nonce: string; child: ChildProcess }): void };
}): VoiceNonceRegisterAckMessage {
  try {
    params.registry.register({
      nonce: params.message.nonce,
      child: params.child,
    });
    return {
      type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
      requestId: params.message.requestId,
      ok: true,
    };
  } catch (error) {
    return {
      type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
      requestId: params.message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Shared settlement guard across the listener, timer, and send callback of
 *  one in-flight registration wait — ensures exactly one of them acts. */
interface NonceRegistrationSettlement {
  settled: boolean;
}

/**
 * Build the ack listener for one in-flight nonce-registration request: on a
 * matching, not-yet-settled ack it marks the wait settled, cancels the timer
 * and unsubscribes itself via `onSettle`, then resolves or rejects per the
 * parent's verdict. Extracted so {@link requestNonceRegistration} does not
 * carry this nesting in its own executor.
 */
function createNonceAckListener(params: {
  requestId: string;
  settlement: NonceRegistrationSettlement;
  onSettle: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
}): (message: unknown) => void {
  return (message: unknown): void => {
    if (!isVoiceNonceRegisterAckMessage(message)) return;
    if (message.requestId !== params.requestId) return;
    if (params.settlement.settled) return;
    params.settlement.settled = true;
    params.onSettle();
    if (message.ok) {
      params.resolve();
    } else {
      params.reject(
        new VoiceNonceRegistrationFailedError(
          message.error ?? "unknown reason",
        ),
      );
    }
  };
}

/**
 * Child side: ask the parent to register `nonce` against this child, and wait
 * for the ack. Rejects if there is no IPC channel, the parent does not
 * respond within `timeoutMs`, or the parent acks with `ok: false`. Resolves
 * once the parent confirms the nonce is registered — the point at which it is
 * safe to dial, since any subsequent Twilio upgrade can now be authenticated.
 */
export function requestNonceRegistration(params: {
  nonce: string;
  proc?: VoiceNonceRegisterProcess;
  timeoutMs?: number;
  requestId?: string;
}): Promise<void> {
  const proc = params.proc ?? (process as unknown as VoiceNonceRegisterProcess);
  const timeoutMs = params.timeoutMs ?? VOICE_NONCE_REGISTER_TIMEOUT_MS;
  const requestId = params.requestId ?? crypto.randomUUID();

  return new Promise<void>((resolve, reject) => {
    if (typeof proc.send !== "function") {
      reject(new VoiceNonceRegistrationNoChannelError());
      return;
    }

    const settlement: NonceRegistrationSettlement = { settled: false };
    let timer: NodeJS.Timeout;
    const listener = createNonceAckListener({
      requestId,
      settlement,
      onSettle: () => {
        clearTimeout(timer);
        proc.off("message", listener);
      },
      resolve,
      reject,
    });

    timer = setTimeout(() => {
      if (settlement.settled) return;
      settlement.settled = true;
      proc.off("message", listener);
      reject(new VoiceNonceRegistrationTimeoutError(timeoutMs));
    }, timeoutMs);

    proc.on("message", listener);

    const message: VoiceNonceRegisterMessage = {
      type: VOICE_NONCE_REGISTER_MESSAGE,
      requestId,
      nonce: params.nonce,
    };
    proc.send(message, (error) => {
      if (error && !settlement.settled) {
        settlement.settled = true;
        clearTimeout(timer);
        proc.off("message", listener);
        reject(error);
      }
    });
  });
}

/** Thrown when the parent tells this child its dial-back was refused, so the
 *  caller sees the real cause instead of a generic connect-wait timeout. */
export class VoiceMediaUpgradeRefusedError extends Error {
  constructor(reason: string) {
    super(`Twilio's media socket was refused by the listener: ${reason}`);
    this.name = "VoiceMediaUpgradeRefusedError";
  }
}

/**
 * Child side: race an in-flight `placeCall`-shaped wait against a parent's
 * upgrade-refusal notice. Resolves to `promise`'s outcome, or rejects with
 * {@link VoiceMediaUpgradeRefusedError} the moment a refusal notice arrives,
 * whichever comes first — so a nonce the listener already 403'd fails fast
 * instead of silently burning the SDK's full connect-wait timeout. Always
 * unsubscribes its listener before returning, win or lose, so a refusal
 * notice for an EARLIER, already-settled dial can never surface on a later
 * one sharing the same process.
 */
export function raceAgainstUpgradeRefusal<T>(
  promise: Promise<T>,
  proc: VoiceNonceRegisterProcess = process as unknown as VoiceNonceRegisterProcess,
): Promise<T> {
  let listener: ((message: unknown) => void) | undefined;
  const refusal = new Promise<never>((_, reject) => {
    listener = (message: unknown): void => {
      if (!isVoiceMediaUpgradeRefusedMessage(message)) return;
      reject(new VoiceMediaUpgradeRefusedError(message.reason));
    };
    proc.on("message", listener);
  });
  return Promise.race([promise, refusal]).finally(() => {
    if (listener) proc.off("message", listener);
  });
}
