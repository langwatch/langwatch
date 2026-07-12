/**
 * LangyTurnRelay — the control-plane consumer of one worker→relay frame stream
 * (LANGY_WORKER_REDESIGN_PLAN §0/§0b), the successor to `runTurn`'s streaming
 * role. One instance per pushed connection (one turn). For each authenticated
 * frame it fans out to two places:
 *
 *   • the LIVE edge — the Redis Stream token buffer the browser tails; and
 *   • the DURABLE log — event-sourcing commands for NAMED (tool-call) and
 *     TERMINAL (final / error) frames, so the audit + final answer survive.
 *
 * Ephemeral frames (delta / status / progress / heartbeat / card) only ever
 * touch the live buffer — tokens are never events.
 *
 * Security per frame (the relay owns replay defence; the crypto lives in
 * langyFrameAuth): verify the HMAC against the conversation's server-only
 * runToken, pin the frame to THIS connection's conversation+turn (cross-turn
 * replay dies here), and dedup the frameNonce (intra-turn replay dies here).
 * All state that must survive an instance restart is durable (runToken, the
 * turn, the dedup set); the relay instance itself is stateless beyond a cache.
 */
import { verifyFrame } from "./langyFrameAuth";
import {
  langyFrameEnvelopeSchema,
  langyRelayFrameSchema,
  type LangyFrameEnvelope,
  type LangyRelayFrame,
} from "./langyRelayFrame";

/** The slice of the token buffer the relay writes (the live edge). */
export interface LangyRelayBuffer {
  appendChunk(a: { conversationId: string; turnId: string; text: string }): Promise<void>;
  appendStatus(a: { conversationId: string; turnId: string; status: string }): Promise<void>;
  appendProgress(a: {
    conversationId: string;
    turnId: string;
    message?: string;
    progress?: number;
  }): Promise<void>;
  appendMilestone(a: {
    conversationId: string;
    turnId: string;
    kind: string;
    detail?: string;
  }): Promise<void>;
  appendTool(a: {
    conversationId: string;
    turnId: string;
    id: string;
    name: string;
    phase: "start" | "end";
    title?: string;
    input?: unknown;
    output?: string;
    isError?: boolean;
  }): Promise<void>;
  markEnd(a: { conversationId: string; turnId: string }): Promise<void>;
  markError(a: { conversationId: string; turnId: string; error: string }): Promise<void>;
  heartbeat(a: { conversationId: string; turnId: string }): Promise<void>;
}

/** The slice of the conversation service the relay dispatches durable events through. */
export interface LangyRelayConversations {
  getRunToken(a: { projectId: string; conversationId: string }): Promise<string | null>;
  recordToolCallStarted(a: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    command?: string;
    input?: unknown;
  }): Promise<void>;
  recordToolCallCompleted(a: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    command?: string;
    input?: unknown;
    durationMs?: number;
    errorText?: string;
  }): Promise<void>;
  ingestAgentTurnResult(a: {
    projectId: string;
    conversationId: string;
    turnId: string;
    status: "completed" | "failed";
    text?: string;
    toolCalls?: { id: string; name: string; input?: unknown; output?: string; isError?: boolean }[];
    errorCode?: string;
  }): Promise<void>;
  recordTurnHandoff(a: {
    projectId: string;
    conversationId: string;
    turnId: string;
    token: string;
  }): Promise<void>;
}

export interface LangyTurnRelayDeps {
  conversations: LangyRelayConversations;
  buffer: LangyRelayBuffer;
  /**
   * Reserve a frameNonce for a turn. Returns true if it was UNSEEN (fresh, the
   * caller should apply it), false if already seen (a replay/redelivery to drop).
   * Backed by a shared Redis SET so any of the load-balanced instances agrees.
   */
  reserveFrameNonce(a: {
    conversationId: string;
    turnId: string;
    frameNonce: string;
  }): Promise<boolean>;
  logger?: { warn(o: unknown, m: string): void; debug?(o: unknown, m: string): void };
}

export type LangyRelayRejection =
  | "malformed-envelope"
  | "no-run-token"
  | "bad-signature"
  | "wrong-turn"
  | "invalid-payload";

export type LangyRelayOutcome =
  | { status: "applied" }
  | { status: "terminal" }
  | { status: "duplicate" }
  | { status: "rejected"; reason: LangyRelayRejection };

/**
 * One relay per pushed connection (one turn). `handle` is called once per ndjson
 * line; it is safe to call after a terminal (further frames are dropped as
 * duplicates or wrong-turn) and after a rejection.
 */
export class LangyTurnRelay {
  private runToken: string | null | undefined; // undefined = not yet loaded
  private pinned: { conversationId: string; turnId: string } | null = null;

  constructor(private readonly deps: LangyTurnRelayDeps) {}

  async handle(raw: unknown): Promise<LangyRelayOutcome> {
    const envelopeParse = langyFrameEnvelopeSchema.safeParse(raw);
    if (!envelopeParse.success) {
      return this.reject("malformed-envelope");
    }
    const envelope = envelopeParse.data;

    // Authenticity FIRST — no field is trusted until the MAC checks out. The
    // runToken is looked up by the (as-yet-unverified) conversationId; a wrong
    // conversationId simply yields a token the MAC won't match against.
    const runToken = await this.loadRunToken(envelope.conversationId, envelope.projectId);
    if (runToken === null) return this.reject("no-run-token");
    if (!verifyFrame(runToken, envelope)) return this.reject("bad-signature");

    // Pin to THIS connection's conversation+turn (turnId is now authenticated).
    // The first verified frame pins; any later frame from a different turn is a
    // cross-turn replay and is refused.
    if (!this.checkTurn(envelope)) return this.reject("wrong-turn");

    // Intra-turn replay: a redelivered/duplicated frameNonce is dropped.
    const fresh = await this.deps.reserveFrameNonce({
      conversationId: envelope.conversationId,
      turnId: envelope.turnId,
      frameNonce: envelope.frameNonce,
    });
    if (!fresh) return { status: "duplicate" };

    const frameParse = langyRelayFrameSchema.safeParse(safeJson(envelope.payload));
    if (!frameParse.success) return this.reject("invalid-payload");

    return this.apply(envelope, frameParse.data);
  }

  private async loadRunToken(
    conversationId: string,
    projectId: string,
  ): Promise<string | null> {
    if (this.runToken === undefined) {
      this.runToken = await this.deps.conversations.getRunToken({
        projectId,
        conversationId,
      });
    }
    return this.runToken ?? null;
  }

  private checkTurn(envelope: LangyFrameEnvelope): boolean {
    if (this.pinned === null) {
      this.pinned = {
        conversationId: envelope.conversationId,
        turnId: envelope.turnId,
      };
      return true;
    }
    return (
      this.pinned.conversationId === envelope.conversationId &&
      this.pinned.turnId === envelope.turnId
    );
  }

  private async apply(
    envelope: LangyFrameEnvelope,
    frame: LangyRelayFrame,
  ): Promise<LangyRelayOutcome> {
    const { projectId, conversationId, turnId } = envelope;
    const at = { conversationId, turnId };

    switch (frame.type) {
      case "delta":
        await this.deps.buffer.appendChunk({ ...at, text: frame.text });
        return { status: "applied" };

      case "status":
        await this.deps.buffer.appendStatus({ ...at, status: frame.status });
        return { status: "applied" };

      case "progress":
        await this.deps.buffer.appendProgress({
          ...at,
          ...(frame.message !== undefined ? { message: frame.message } : {}),
          ...(frame.progress !== undefined ? { progress: frame.progress } : {}),
        });
        return { status: "applied" };

      case "heartbeat":
        // Liveness only — refresh the turn's freshness, write no content.
        await this.deps.buffer.heartbeat(at);
        return { status: "applied" };

      case "card":
        // A live UI card in the ordered stream. Rendered via the milestone slot
        // (kind + detail); card `data` is carried on the stream for the renderer.
        await this.deps.buffer.appendMilestone({
          ...at,
          kind: frame.kind,
          ...(frame.detail !== undefined ? { detail: frame.detail } : {}),
        });
        return { status: "applied" };

      case "tool":
        return this.applyTool(projectId, at, frame);

      case "final":
        await this.deps.buffer.markEnd(at);
        await this.deps.conversations.ingestAgentTurnResult({
          projectId,
          conversationId,
          turnId,
          status: "completed",
          ...(frame.text !== undefined ? { text: frame.text } : {}),
          ...(frame.toolCalls !== undefined ? { toolCalls: frame.toolCalls } : {}),
        });
        return { status: "terminal" };

      case "error":
        await this.deps.buffer.markError({ ...at, error: frame.error });
        await this.deps.conversations.ingestAgentTurnResult({
          projectId,
          conversationId,
          turnId,
          status: "failed",
          ...(frame.code !== undefined ? { errorCode: frame.code } : {}),
        });
        return { status: "terminal" };

      case "handoff":
        // ADR-048: the worker checkpointed on shutdown. End the live stream and
        // persist the opaque resume token so the next turn resumes from it. The
        // turn is NOT failed — it will be re-driven on a fresh worker.
        await this.deps.buffer.markEnd(at);
        if (frame.resumeToken !== undefined && frame.resumeToken !== "") {
          await this.deps.conversations.recordTurnHandoff({
            projectId,
            conversationId,
            turnId,
            token: frame.resumeToken,
          });
        }
        return { status: "terminal" };
    }
  }

  private async applyTool(
    projectId: string,
    at: { conversationId: string; turnId: string },
    frame: Extract<LangyRelayFrame, { type: "tool" }>,
  ): Promise<LangyRelayOutcome> {
    // Live card first so it opens as promptly as the tokens flow…
    await this.deps.buffer.appendTool({
      ...at,
      id: frame.id,
      name: frame.name,
      phase: frame.phase,
      ...(frame.title !== undefined ? { title: frame.title } : {}),
      ...(frame.input !== undefined ? { input: frame.input } : {}),
      ...(frame.output !== undefined ? { output: frame.output } : {}),
      ...(frame.isError !== undefined ? { isError: frame.isError } : {}),
    });
    // …then the durable milestone (a tool call is a meaningful audit event).
    if (frame.phase === "start") {
      await this.deps.conversations.recordToolCallStarted({
        projectId,
        ...at,
        toolCallId: frame.id,
        toolName: frame.name,
        ...(frame.command !== undefined ? { command: frame.command } : {}),
        ...(frame.input !== undefined ? { input: frame.input } : {}),
      });
    } else {
      await this.deps.conversations.recordToolCallCompleted({
        projectId,
        ...at,
        toolCallId: frame.id,
        toolName: frame.name,
        ...(frame.isError !== undefined ? { isError: frame.isError } : {}),
        ...(frame.command !== undefined ? { command: frame.command } : {}),
        ...(frame.input !== undefined ? { input: frame.input } : {}),
        ...(frame.durationMs !== undefined ? { durationMs: frame.durationMs } : {}),
        ...(frame.isError && frame.output !== undefined ? { errorText: frame.output } : {}),
      });
    }
    return { status: "applied" };
  }

  private reject(reason: LangyRelayRejection): LangyRelayOutcome {
    this.deps.logger?.warn({ reason }, "langy relay dropped a frame");
    return { status: "rejected", reason };
  }
}

/** Parse a JSON string, returning null (not throwing) on malformed input. */
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
