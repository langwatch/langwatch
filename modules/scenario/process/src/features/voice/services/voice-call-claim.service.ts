import type { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

import { createLogger } from "@langwatch/observability";
import type { VoiceMediaUpgrade } from "@langwatch/scenario-contract";

import { handOffVoiceSocket } from "../../../channels/voice-socket-handoff.channels.ts";
import type {
  PendingVoiceCall,
  PendingVoiceCallStoreRepository,
} from "../../../repositories/pending-voice-call-store.repository.ts";

const logger = createLogger("langwatch:voice:call-claim");

// Slice 1 spike for https://github.com/langwatch/tasks/issues/1002: claim a pending call,
// spawn the child after the upgrade arrives, then hand it the raw socket.

/** How long a refused socket gets to close itself before the parent destroys it. */
const REFUSAL_CLOSE_TIMEOUT_MS = 5000;

/**
 * The claiming pod spawns the child after the upgrade arrives, then hands it the raw socket.
 * An unknown or already-used nonce is refused 403 and spawns nothing.
 */
export class VoiceCallClaimService {
  static create(input: {
    pending: PendingVoiceCallStoreRepository;
    spawnChild: (call: PendingVoiceCall) => ChildProcess;
  }): VoiceCallClaimService {
    return new VoiceCallClaimService(input.pending, input.spawnChild);
  }

  private constructor(
    private readonly pending: PendingVoiceCallStoreRepository,
    private readonly spawnChild: (call: PendingVoiceCall) => ChildProcess,
  ) {}

  accept(upgrade: VoiceMediaUpgrade): void {
    const { socket } = upgrade;
    if (!(socket instanceof Socket)) {
      logger.error({ url: upgrade.url }, "voice media upgrade arrived without a TCP socket");
      (socket as { destroy?: () => void }).destroy?.();
      return;
    }
    // Node detaches the http server's socket error handler before emitting "upgrade".
    // Without this, a client reset during take/spawn is an uncaught exception.
    socket.on("error", (error: Error) => {
      logger.warn({ error, nonce: upgrade.nonce }, "voice media socket errored");
    });
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
      this.refuse(socket);
      return;
    }
    const child = this.spawnChild(result.call);
    child.once("error", (error: Error) => {
      logger.error({ error, nonce: upgrade.nonce }, "voice child failed to spawn");
      socket.destroy();
    });
    // "error" only covers a spawn/kill/IPC-send failure; a child that crashes or is killed
    // after spawning exits silently without this, leaving no log and an unreleased socket.
    child.once("exit", (code, signal) => {
      logger.warn({ nonce: upgrade.nonce, code, signal }, "voice child exited");
    });
    try {
      await handOffVoiceSocket({
        child,
        socket,
        nonce: upgrade.nonce,
        url: upgrade.url,
        method: upgrade.method,
        headers: { ...upgrade.headers },
        head: Buffer.from(upgrade.head),
      });
    } catch (error) {
      child.kill();
      throw error;
    }
    logger.info({ nonce: upgrade.nonce }, "voice media socket handed to spawned child");
    // child.send(msg, socket) already closes the parent's handle (Node docs: keepOpen defaults
    // to false); this is a no-op safety net, not the real release, in case that ever changes.
    socket.destroy();
  }

  /** Ends the refusal response; destroys the socket itself if the client never closes its side. */
  private refuse(socket: Socket): void {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    const timeout = setTimeout(() => socket.destroy(), REFUSAL_CLOSE_TIMEOUT_MS);
    socket.once("close", () => clearTimeout(timeout));
  }
}
