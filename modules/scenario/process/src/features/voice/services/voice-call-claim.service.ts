import type { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

import { createLogger } from "@langwatch/observability";
import type { VoiceMediaUpgrade } from "@langwatch/scenario-contract";

import { handOffVoiceSocket } from "../../../channels/voice-socket-handoff.channels.ts";
import type {
  PendingVoiceCall,
  PendingVoiceCallRepository,
} from "../../../repositories/pending-voice-call.repository.ts";
import type { ScenarioCancellationRepository } from "../../../repositories/scenario-cancellation.repository.ts";
import { isValidTwilioSignature } from "../../../rules/twilio-signature.rules.ts";

const logger = createLogger("langwatch:voice:call-claim");

const UPGRADE_PATH = /^\/twilio\/([^/]+)\/([^/]+)$/;
const FORBIDDEN = "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n";

/** A claimed run's child, or the cancel that beat the spawn to it. */
type ClaimedRun = { child?: ChildProcess; cancelled: boolean };

/**
 * The worker Twilio dials claims the call: the pending call must exist, Twilio's signature must
 * be valid, and only the claim that wins spawns the child and hands it the raw socket. A bad
 * signature never spends the nonce. A cancel for a claimed run kills its child.
 */
export class VoiceCallClaimService {
  static create(input: {
    pending: PendingVoiceCallRepository;
    cancellations: ScenarioCancellationRepository;
    authTokenFor: (input: { projectId: string }) => Promise<string>;
    publicBaseUrl: string;
    spawnChild: (call: PendingVoiceCall) => ChildProcess;
  }): VoiceCallClaimService {
    return new VoiceCallClaimService(input);
  }

  private readonly claimed = new Map<string, ClaimedRun>();
  private subscription: Promise<() => Promise<void>> | undefined;

  private constructor(
    private readonly input: {
      pending: PendingVoiceCallRepository;
      cancellations: ScenarioCancellationRepository;
      authTokenFor: (input: { projectId: string }) => Promise<string>;
      publicBaseUrl: string;
      spawnChild: (call: PendingVoiceCall) => ChildProcess;
    },
  ) {}

  /** Stops listening for cancellations. */
  async close(): Promise<void> {
    const unsubscribe = await this.subscription;
    this.subscription = undefined;
    await unsubscribe?.();
  }

  accept(upgrade: VoiceMediaUpgrade): void {
    const { socket } = upgrade;
    if (!(socket instanceof Socket)) {
      logger.error({ url: upgrade.url }, "voice media upgrade arrived without a TCP socket");
      (socket as { destroy?: () => void }).destroy?.();
      return;
    }
    this.claim({ upgrade, socket }).catch((error: unknown) => {
      logger.error({ error, nonce: upgrade.nonce }, "voice media upgrade could not be claimed");
      socket.destroy();
    });
  }

  private refuse({ socket, url, reason }: { socket: Socket; url: string; reason: string }): void {
    logger.warn({ url, status: 403, reason }, "voice media upgrade refused");
    socket.end(FORBIDDEN);
  }

  private async claim({
    upgrade,
    socket,
  }: {
    upgrade: VoiceMediaUpgrade;
    socket: Socket;
  }): Promise<void> {
    const { url } = upgrade;
    const pathname = new URL(url, "http://door.invalid").pathname;
    const match = UPGRADE_PATH.exec(pathname);
    if (!match) return this.refuse({ socket, url, reason: "unrecognised path" });
    const key = { scenarioRunId: match[1]!, nonce: match[2]! };

    const peeked = await this.input.pending.peek(key);
    if (!peeked.found) return this.refuse({ socket, url, reason: "no pending call" });

    const header = upgrade.headers["x-twilio-signature"];
    const authToken = await this.input.authTokenFor({ projectId: peeked.call.projectId });
    const signed = `${this.input.publicBaseUrl.replace(/\/$/, "")}${pathname}`;
    if (
      typeof header !== "string" ||
      !isValidTwilioSignature({ authToken, url: signed, signature: header })
    ) {
      return this.refuse({ socket, url, reason: "bad signature" });
    }

    if (this.claimed.has(key.scenarioRunId)) {
      return this.refuse({ socket, url, reason: "run already claimed here" });
    }
    const run: ClaimedRun = { cancelled: false };
    this.claimed.set(key.scenarioRunId, run);
    await this.listenForCancellations();
    const result = await this.input.pending.claim(key);
    if (!result.claimed) {
      this.forget({ scenarioRunId: key.scenarioRunId, run });
      return this.refuse({ socket, url, reason: result.reason });
    }
    try {
      await this.spawnAndHandOff({ upgrade, socket, call: result.call, run });
    } catch (error) {
      this.forget({ scenarioRunId: key.scenarioRunId, run });
      throw error;
    }
  }

  private async spawnAndHandOff({
    upgrade,
    socket,
    call,
    run,
  }: {
    upgrade: VoiceMediaUpgrade;
    socket: Socket;
    call: PendingVoiceCall;
    run: ClaimedRun;
  }): Promise<void> {
    if (run.cancelled) {
      socket.destroy();
      this.forget({ scenarioRunId: call.scenarioRunId, run });
      return;
    }
    const child = this.input.spawnChild(call);
    run.child = child;
    child.once("exit", () => this.forget({ scenarioRunId: call.scenarioRunId, run }));
    child.once("error", (error: Error) => {
      logger.error({ error, nonce: upgrade.nonce }, "voice child failed to spawn");
      socket.destroy();
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
    if (run.cancelled) child.kill();
    logger.info({ nonce: upgrade.nonce }, "voice media socket handed to spawned child");
  }

  /** Drops `run` only while it is still the entry, so a losing claim never drops the winner. */
  private forget({ scenarioRunId, run }: { scenarioRunId: string; run: ClaimedRun }): void {
    if (this.claimed.get(scenarioRunId) === run) this.claimed.delete(scenarioRunId);
  }

  /** One subscription for the worker, opened no later than the first claim. */
  private async listenForCancellations(): Promise<void> {
    this.subscription ??= this.input.cancellations.subscribe(({ scenarioRunId }) => {
      const run = this.claimed.get(scenarioRunId);
      if (!run) return;
      run.cancelled = true;
      run.child?.kill();
    });
    await this.subscription;
  }
}
