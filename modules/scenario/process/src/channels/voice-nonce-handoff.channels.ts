// Child -> parent Twilio stream-nonce registration: prevent 403 by registering nonce before dial.
// The messages themselves are the contract's; this file holds each side's handling of them.

import type { ChildProcess } from "node:child_process";

import { generate } from "@langwatch/ksuid";
import {
  isVoiceMediaUpgradeRefusedMessage,
  isVoiceNonceRegisterAckMessage,
  VOICE_NONCE_REGISTER_ACK_MESSAGE,
  VOICE_NONCE_REGISTER_MESSAGE,
  type VoiceNonceRegisterAckMessage,
  type VoiceNonceRegisterMessage,
} from "@langwatch/scenario-contract";

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
 * Parent side: handle one child's registration request — register the nonce with
 * `registry` against the child and the Twilio auth token its job carries, then build the
 * ack. A child whose job has no Twilio token is refused: its upgrade could not be verified.
 */
export async function handleVoiceNonceRegisterMessage(params: {
  message: VoiceNonceRegisterMessage;
  child: ChildProcess;
  authToken: string | undefined;
  registry: {
    register(p: { nonce: string; child: ChildProcess; authToken: string }): Promise<void>;
  };
}): Promise<VoiceNonceRegisterAckMessage> {
  const { requestId } = params.message;
  if (params.authToken === undefined) {
    return {
      type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
      requestId,
      ok: false,
      error: "this run carries no Twilio credential to verify its media upgrade with",
    };
  }
  try {
    await params.registry.register({
      nonce: params.message.nonce,
      child: params.child,
      authToken: params.authToken,
    });
    return { type: VOICE_NONCE_REGISTER_ACK_MESSAGE, requestId, ok: true };
  } catch (error) {
    return {
      type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Shared settlement guard across the listener, timer, and send callback of
 *  one in-flight registration wait — ensures exactly one of them acts. */
interface NonceRegistrationSettlement {
  isSettled: boolean;
}

/**
 * Build the ack listener for one in-flight nonce-registration request: a
 * matching, unsettled ack marks it settled, cancels the timer, then
 * resolves or rejects. Extracted out of `requestNonceRegistration`'s executor.
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
    if (params.settlement.isSettled) return;
    params.settlement.isSettled = true;
    params.onSettle();
    if (message.ok) {
      params.resolve();
    } else {
      params.reject(new VoiceNonceRegistrationFailedError(message.error ?? "unknown reason"));
    }
  };
}

/**
 * Child side: ask the parent to register `nonce`, and wait for the ack.
 * Rejects with no IPC channel, on timeout, or `ok: false`. Resolves once
 * registered — the point it is safe to dial, since Twilio can now be authenticated.
 */
export function requestNonceRegistration(params: {
  nonce: string;
  proc?: VoiceNonceRegisterProcess;
  timeoutMs?: number;
  requestId?: string;
}): Promise<void> {
  const proc: VoiceNonceRegisterProcess = params.proc ?? process;
  const timeoutMs = params.timeoutMs ?? VOICE_NONCE_REGISTER_TIMEOUT_MS;
  const requestId = params.requestId ?? generate("scenario").toString();

  return new Promise<void>((resolve, reject) => {
    if (typeof proc.send !== "function") {
      reject(new VoiceNonceRegistrationNoChannelError());
      return;
    }

    const settlement: NonceRegistrationSettlement = { isSettled: false };
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
      if (settlement.isSettled) return;
      settlement.isSettled = true;
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
      if (error && !settlement.isSettled) {
        settlement.isSettled = true;
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

// Child: race placeCall wait against parent's upgrade-refusal notice. Fails fast on refusal.
// Unsubscribes listener to prevent stale refusal affecting later dials.
export function raceAgainstUpgradeRefusal<T>(
  promise: Promise<T>,
  proc: VoiceNonceRegisterProcess = process,
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
