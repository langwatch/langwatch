import type { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

import { createLogger } from "@langwatch/observability";
import type { VoiceMediaUpgrade } from "@langwatch/scenario-contract";

import { handOffVoiceSocket } from "../../../channels/voice-socket-handoff.channels.ts";

const logger = createLogger("langwatch:voice:call-claim");

/**
 * Slice 1 spike for https://github.com/langwatch/tasks/issues/1002: the time a claiming
 * pod has to spawn the child and finish the media handshake after the upgrade arrives.
 */
export const VOICE_CLAIM_HANDSHAKE_BUDGET_MS = 5000;

/** A call waiting to be claimed (spike for https://github.com/langwatch/tasks/issues/1002). */
export interface PendingVoiceCall {
  nonce: string;
}

/** What taking a nonce found: the pending call, answered at most once. */
export type TakenPendingVoiceCall = { taken: true; call: PendingVoiceCall } | { taken: false };

/** Single-use lookup of pending calls (spike: https://github.com/langwatch/tasks/issues/1002). */
export interface PendingVoiceCallStore {
  take(nonce: string): Promise<TakenPendingVoiceCall>;
}

/** In-memory store (spike for https://github.com/langwatch/tasks/issues/1002); take deletes. */
export class InMemoryPendingVoiceCallStore implements PendingVoiceCallStore {
  private readonly calls = new Map<string, PendingVoiceCall>();

  add(call: PendingVoiceCall): void {
    this.calls.set(call.nonce, call);
  }

  take(nonce: string): Promise<TakenPendingVoiceCall> {
    const call = this.calls.get(nonce);
    this.calls.delete(nonce);
    return Promise.resolve(call ? { taken: true, call } : { taken: false });
  }
}

/**
 * Slice 1 spike for https://github.com/langwatch/tasks/issues/1002: the claiming pod
 * spawns the child after the upgrade arrives, then hands it the raw socket. An unknown
 * or already-used nonce is refused 403 and spawns nothing.
 */
export class VoiceCallClaimService {
  static create(input: {
    pending: PendingVoiceCallStore;
    spawnChild: (call: PendingVoiceCall) => ChildProcess;
  }): VoiceCallClaimService {
    return new VoiceCallClaimService(input.pending, input.spawnChild);
  }

  private constructor(
    private readonly pending: PendingVoiceCallStore,
    private readonly spawnChild: (call: PendingVoiceCall) => ChildProcess,
  ) {}

  accept(upgrade: VoiceMediaUpgrade): void {
    const { socket } = upgrade;
    if (!(socket instanceof Socket)) {
      logger.error({ url: upgrade.url }, "voice media upgrade arrived without a TCP socket");
      return;
    }
    this.claim({ upgrade, socket }).catch((error: unknown) => {
      logger.error({ error, nonce: upgrade.nonce }, "voice media upgrade could not be claimed");
      socket.destroy();
    });
  }

  private async claim({
    upgrade,
    socket,
  }: {
    upgrade: VoiceMediaUpgrade;
    socket: Socket;
  }): Promise<void> {
    const result = await this.pending.take(upgrade.nonce);
    if (!result.taken) {
      logger.warn(
        { url: upgrade.url, status: 403 },
        "voice media upgrade refused: no pending call",
      );
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const child = this.spawnChild(result.call);
    await handOffVoiceSocket({
      child,
      socket,
      nonce: upgrade.nonce,
      url: upgrade.url,
      method: upgrade.method,
      headers: { ...upgrade.headers },
      head: Buffer.from(upgrade.head),
    });
    logger.info({ nonce: upgrade.nonce }, "voice media socket handed to spawned child");
  }
}
