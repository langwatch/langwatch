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
import type { CliResultDigest, CliToolResult } from "@langwatch/cli-cards";
import { resolveCapabilityProgress } from "~/features/langy/components/capabilities/capabilityRegistry";
import { verifyFrame } from "./langyFrameAuth";
import { LangyCliEnvelopeService } from "../execution/langy-cli-envelope.service";
import {
  langyAgentErrorFromErrorFrame,
  serializeLangyTurnError,
} from "../execution/langy-turn-errors";
import {
  langyFrameEnvelopeSchema,
  langyRelayFrameSchema,
  type LangyFrameEnvelope,
  type LangyRelayFrame,
} from "./langyRelayFrame";

/** The slice of the token buffer the relay writes (the live edge). */
export interface LangyRelayBuffer {
  appendChunk(a: { conversationId: string; turnId: string; text: string }): Promise<void>;
  appendReasoning(a: { conversationId: string; turnId: string; text: string }): Promise<void>;
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
  appendPlan(a: {
    conversationId: string;
    turnId: string;
    items: Array<{ content: string; status: string }>;
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
    digest?: CliResultDigest;
    result?: CliToolResult;
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
    toolCalls?: {
      id: string;
      name: string;
      input?: unknown;
      output?: string;
      isError?: boolean;
      result?: CliToolResult;
    }[];
    errorCode?: string;
  }): Promise<void>;
  recordTurnHandoff(a: {
    projectId: string;
    conversationId: string;
    turnId: string;
    token: string;
  }): Promise<void>;
  recordPlanUpdated(a: {
    projectId: string;
    conversationId: string;
    turnId: string;
    items: Array<{ content: string; status: string }>;
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
  private pinned: {
    projectId: string;
    conversationId: string;
    turnId: string;
  } | null = null;

  /**
   * The project+conversation+turn this connection authenticated and pinned
   * to, or null before the first verified frame. Read by the relay route for
   * its end-of-stream summary — the ids here are MAC-verified, unlike the
   * claimed ids on a rejection.
   */
  get pinnedTurn(): {
    projectId: string;
    conversationId: string;
    turnId: string;
  } | null {
    return this.pinned;
  }
  /**
   * Re-types a `bash("langwatch …")` tool frame as the capability it invoked —
   * BEFORE anything is recorded, so the live buffer, the durable milestone
   * events and every consumer downstream see `langwatch.<resource>.<verb>`
   * with the reduced output and its digest, never "the agent ran bash".
   */
  private readonly cliEnvelope = LangyCliEnvelopeService.create();

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
    if (runToken === null) return this.reject("no-run-token", envelope);
    if (!verifyFrame(runToken, envelope)) {
      return this.reject("bad-signature", envelope);
    }

    // Pin to THIS connection's conversation+turn (turnId is now authenticated).
    // The first verified frame pins; any later frame from a different turn is a
    // cross-turn replay and is refused.
    if (!this.checkTurn(envelope)) return this.reject("wrong-turn", envelope);

    // Intra-turn replay: a redelivered/duplicated frameNonce is dropped.
    const fresh = await this.deps.reserveFrameNonce({
      conversationId: envelope.conversationId,
      turnId: envelope.turnId,
      frameNonce: envelope.frameNonce,
    });
    if (!fresh) return { status: "duplicate" };

    const frameParse = langyRelayFrameSchema.safeParse(safeJson(envelope.payload));
    if (!frameParse.success) return this.reject("invalid-payload", envelope);

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
        projectId: envelope.projectId,
        conversationId: envelope.conversationId,
        turnId: envelope.turnId,
      };
      return true;
    }
    // projectId is pinned too: the runToken is cached after frame 1 while
    // apply() reads projectId off each envelope, so without this a caller
    // holding a valid token could switch projectId on later frames and sign
    // them with the token they already have — writing this conversation's
    // frames under another tenant's id. Signing projectId only means
    // something if every frame is held to the pinned value.
    return (
      this.pinned.projectId === envelope.projectId &&
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

      case "reasoning":
        // Ephemeral thinking tokens — live edge only, never durable. Same live
        // channel as status/progress; the browser shows them while they stream
        // and drops them on settle (no fold ingest, no message part).
        await this.deps.buffer.appendReasoning({ ...at, text: frame.text });
        return { status: "applied" };

      case "status":
        await this.deps.buffer.appendStatus({ ...at, status: frame.status });
        return { status: "applied" };

      case "progress":
        await this.deps.buffer.appendProgress({
          ...at,
          ...(frame.message !== undefined ? { message: frame.message } : {}),
          ...(frame.progress !== undefined ? { progress: frame.progress } : {}),
          ...(frame.current !== undefined ? { current: frame.current } : {}),
          ...(frame.total !== undefined ? { total: frame.total } : {}),
          ...(frame.batchItems !== undefined
            ? { batchItems: frame.batchItems }
            : {}),
          ...(frame.batchDurationMs !== undefined
            ? { batchDurationMs: frame.batchDurationMs }
            : {}),
        });
        return { status: "applied" };

      case "heartbeat":
        // Liveness only — refresh the turn's freshness, write no content.
        await this.deps.buffer.heartbeat(at);
        return { status: "applied" };

      case "plan":
        // A full plan snapshot. Both a LIVE checklist (buffer) and a DURABLE
        // record (plan_updated, last-write-wins on the turn fold). The live card
        // lands first so the checklist reconciles as promptly as the tokens; the
        // durable event survives reload. Redelivery already died at the frameNonce
        // gate above, so this dispatches at-most-once per distinct snapshot.
        await this.deps.buffer.appendPlan({ ...at, items: frame.items });
        await this.deps.conversations.recordPlanUpdated({
          projectId,
          ...at,
          items: frame.items,
        });
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

      case "error": {
        // The LIVE edge must carry the SAME classified, serialized domain error
        // the durable path records — not the raw frame message. The browser reads
        // the error off the stream as a JSON domain error (readLangyStreamError);
        // a raw string parses as null and collapses every named failure into the
        // generic "Something went wrong". Classify by the typed herr envelope
        // when the frame carries one (the full cause chain — e.g. the gateway's
        // no_provider_configured riding as a reason — persists into LastError),
        // falling back to the vetted `code` (never the prose), the same mapping
        // ingestAgentTurnResult applies to the fold.
        const classified = langyAgentErrorFromErrorFrame({
          code: frame.code ?? frame.error,
          ...(frame.herr !== undefined ? { cause: frame.herr } : {}),
        });
        await this.deps.buffer.markError({
          ...at,
          error: serializeLangyTurnError(classified),
        });
        await this.deps.conversations.ingestAgentTurnResult({
          projectId,
          conversationId,
          turnId,
          status: "failed",
          ...(frame.code !== undefined ? { errorCode: frame.code } : {}),
          ...(frame.herr !== undefined ? { errorCause: frame.herr } : {}),
        });
        return { status: "terminal" };
      }

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
    // Re-type a shell call that was really the LangWatch CLI: typed name,
    // stdout reduced to its JSON document, and the result digest computed.
    // Anything else passes through untouched (identity, not a copy).
    const call = this.cliEnvelope.normalizeToolFrame({
      frame: {
        id: frame.id,
        name: frame.name,
        phase: frame.phase,
        ...(frame.title !== undefined ? { title: frame.title } : {}),
        ...(frame.input !== undefined ? { input: frame.input } : {}),
        ...(frame.output !== undefined ? { output: frame.output } : {}),
        ...(frame.isError !== undefined ? { isError: frame.isError } : {}),
        ...(frame.result !== undefined ? { result: frame.result } : {}),
      },
    });

    // Live card first so it opens as promptly as the tokens flow…
    await this.deps.buffer.appendTool({
      ...at,
      id: call.id,
      name: call.name,
      phase: frame.phase,
      ...(call.title !== undefined ? { title: call.title } : {}),
      ...(call.input !== undefined ? { input: call.input } : {}),
      ...(call.output !== undefined ? { output: call.output } : {}),
      ...(call.isError !== undefined ? { isError: call.isError } : {}),
      ...(call.digest !== undefined ? { digest: call.digest } : {}),
      ...(call.result !== undefined ? { result: call.result } : {}),
    });
    // A capability's present-continuous sub-status ("Searching traces…") for the
    // live status line — emitted AFTER the tool frame so the cold-start clear (it
    // fires on the tool entry, once per turn) cannot wipe it, and cleared with an
    // empty status when the call settles, so it shows only between the step's
    // start and its output. Non-capability calls (a raw bash) carry no label.
    const progress = resolveCapabilityProgress(call.name);
    if (progress) {
      await this.deps.buffer.appendStatus({
        ...at,
        status: frame.phase === "start" ? `${progress.headline}…` : "",
      });
    }

    // …then the durable milestone (a tool call is a meaningful audit event).
    if (frame.phase === "start") {
      await this.deps.conversations.recordToolCallStarted({
        projectId,
        ...at,
        toolCallId: call.id,
        toolName: call.name,
        ...(frame.command !== undefined ? { command: frame.command } : {}),
        ...(call.input !== undefined ? { input: call.input } : {}),
      });
    } else {
      await this.deps.conversations.recordToolCallCompleted({
        projectId,
        ...at,
        toolCallId: call.id,
        toolName: call.name,
        ...(call.isError !== undefined ? { isError: call.isError } : {}),
        ...(frame.command !== undefined ? { command: frame.command } : {}),
        ...(call.input !== undefined ? { input: call.input } : {}),
        ...(frame.durationMs !== undefined ? { durationMs: frame.durationMs } : {}),
        ...(call.isError && call.output !== undefined ? { errorText: call.output } : {}),
      });
    }
    return { status: "applied" };
  }

  private reject(
    reason: LangyRelayRejection,
    envelope?: Pick<
      LangyFrameEnvelope,
      "conversationId" | "turnId" | "projectId"
    >,
  ): LangyRelayOutcome {
    // The envelope ids are CLAIMED, not verified, for every reason that fires
    // before the MAC check — but a flood of bad-signature frames is exactly
    // when an operator needs to know which conversation is being replayed at,
    // so the claim is worth logging as long as it's labelled as one.
    this.deps.logger?.warn(
      {
        reason,
        ...(envelope
          ? {
              claimedProjectId: envelope.projectId,
              claimedConversationId: envelope.conversationId,
              claimedTurnId: envelope.turnId,
            }
          : {}),
      },
      "langy relay dropped a frame",
    );
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
