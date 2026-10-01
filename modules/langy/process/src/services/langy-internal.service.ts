import { ForbiddenError, NotFoundError } from "@langwatch/api/rest";
import {
  LangyApiRequestInvalidError,
  LangyRelayUnavailableError,
  type LangyRelayConnection,
  type RelayTally,
  type LangyTurnResultInput,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { LangyRestMetrics } from "./langy-rest-metrics-prometheus.service.ts";
import type { LangyService } from "./langy.service.ts";

const logger = createLogger("langwatch:langy:internal");

export type LangyInternalMetrics = Readonly<{
  /** One completed or failed turn, by outcome. */
  turnResult(status: "completed" | "failed"): void;
  /** A revoke that named a key which is not a Langy session key. */
  sessionKeyRevokeRefused(): void;
}>;

/** One counter per relay frame outcome, so the rates stay graphable fleet-wide. */
export type LangyRelayFrameMetrics = Readonly<{
  frames(outcome: "applied" | "duplicate" | "rejected" | "terminal", count: number): void;
}>;

export class LangyInternalService {
  readonly #langy: LangyService;
  readonly #metrics: LangyRestMetrics;
  readonly #hasLiveBuffer: boolean;

  private constructor(langy: LangyService, metrics: LangyRestMetrics, hasLiveBuffer: boolean) {
    this.#langy = langy;
    this.#metrics = metrics;
    this.#hasLiveBuffer = hasLiveBuffer;
  }

  static create(
    langy: LangyService,
    metrics: LangyRestMetrics,
    hasLiveBuffer: boolean,
  ): LangyInternalService {
    return new LangyInternalService(langy, metrics, hasLiveBuffer);
  }

  async ingestTurnResult(input: LangyTurnResultInput): Promise<{ status: "accepted" }> {
    const { turnId, projectId, conversationId } = input;
    if (!(await this.#langy.turnExists({ turnId, projectId, conversationId }))) {
      throw new NotFoundError("turn not found");
    }

    await this.#langy.ingestAgentTurnResult(input);
    this.#metrics.internal.turnResult(input.status);
    logger.info(
      { turnId, projectId, conversationId, status: input.status },
      "langy turn result ingested",
    );
    return { status: "accepted" as const };
  }

  async revokeCredentials(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<{ outcome: "revoked" | "already_revoked" }> {
    const outcome = await this.#langy.revokeWorkerSessionKey(input);
    if (outcome === "not_found") throw new NotFoundError("Session key not found");
    if (outcome === "refused") {
      this.#metrics.internal.sessionKeyRevokeRefused();
      throw new ForbiddenError("Not a Langy session key");
    }
    return { outcome };
  }

  async receiveFrames(body: ReadableStream<Uint8Array> | null): Promise<RelayTally> {
    if (!this.#hasLiveBuffer) throw new LangyRelayUnavailableError();
    if (!body)
      throw new LangyApiRequestInvalidError([
        { path: [], message: "A frame stream must carry a request body" },
      ]);
    const relay = this.#langy.openRelayConnection();
    const tally = await readFrames({ relay, body });
    this.#metrics.relayFrames.frames("applied", tally.applied);
    this.#metrics.relayFrames.frames("duplicate", tally.duplicate);
    this.#metrics.relayFrames.frames("rejected", tally.rejected);
    if (tally.terminal) this.#metrics.relayFrames.frames("terminal", 1);
    logger.info({ ...tally, ...relay.pinnedTurn }, "langy relay stream closed");
    return tally;
  }
}

/** Reads the stream to its end, applying one frame per line as it arrives. */
async function readFrames(input: {
  relay: LangyRelayConnection;
  body: ReadableStream<Uint8Array>;
}): Promise<RelayTally> {
  const { relay } = input;
  const tally: RelayTally = { applied: 0, duplicate: 0, rejected: 0, terminal: false };
  const reader = input.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });

      for (let nl = pending.indexOf("\n"); nl >= 0; nl = pending.indexOf("\n")) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (line) await applyLine(relay, line, tally);
      }
    }

    // A final line without a trailing newline.
    const tail = pending.trim();
    if (tail) await applyLine(relay, tail, tally);
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        ...relay.pinnedTurn,
      },
      "relay stream read error — connection closed mid-turn",
    );
  }

  return tally;
}

async function applyLine(
  relay: LangyRelayConnection,
  line: string,
  tally: RelayTally,
): Promise<void> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    tally.rejected += 1;

    return;
  }

  const outcome = await relay.handle(parsed);

  switch (outcome.status) {
    case "applied":
      tally.applied += 1;
      break;
    case "terminal":
      tally.applied += 1;
      tally.terminal = true;
      break;
    case "duplicate":
      tally.duplicate += 1;
      break;
    case "rejected":
      tally.rejected += 1;
      break;
  }
}
