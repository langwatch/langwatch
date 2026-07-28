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
import {
  cliToolResultPayload,
  type CliResultDigest,
  type CliToolResult,
} from "@langwatch/langy";
import { resolveCapabilityProgress } from "~/features/langy/components/capabilities/capabilityRegistry";
import { env } from "~/env.mjs";
import type { LangyResourceLinkStore } from "./langyResourceLinks";
import {
  extractPlatformUrl,
  isPreciseResourceHref,
  toRelativeSameOriginHref,
} from "~/utils/platformHref";
import { verifyFrame } from "./langyFrameAuth";
import {
  LangyCliEnvelopeService,
  type LangyToolFrame,
} from "../execution/langy-cli-envelope.service";
import {
  isSoleLangwatchInvocation,
  parseAllLangwatchCommands,
  parseLangwatchCommand,
  type LangwatchCommand,
} from "../execution/langwatchCommand";
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

/** The CLI grammar the agent uses to say WHICH resource to open — never an
 * address. `langwatch navigate open <resourceId>`; the platform resolves
 * where that resource actually lives from the link it already remembered
 * having surfaced this turn (see `resourceLinks` below). */
const NAVIGATE_RESOURCE = "navigate";
const NAVIGATE_VERB = "open";

/** The resource id a parsed invocation names, when it is `navigate open`. */
function navigateResourceIdOf(
  invocation: LangwatchCommand | null,
): { resourceId: string } | null {
  if (
    !invocation ||
    invocation.resource !== NAVIGATE_RESOURCE ||
    invocation.verb !== NAVIGATE_VERB
  ) {
    return null;
  }
  const positionals = invocation.args._;
  const resourceId = Array.isArray(positionals) ? positionals[0] : undefined;
  return typeof resourceId === "string" && resourceId ? { resourceId } : null;
}

/**
 * IDs a precise platform link legitimately opens BEYOND its path's primary
 * resource, so `navigate open <id>` resolves for any of them. A scenario-run
 * link opens the run in a drawer (`…?drawer.open=scenarioRunDetail&
 * drawer.scenarioRunId={runId}`) whose digest primaryId is the parent batch,
 * not the run; the run id rides the `drawer.scenarioRunId` query. (The legacy
 * nested form carried it as `openRun` — read both so either resolves.)
 */
function nestedResourceIds(platformUrl: string): string[] {
  const ids: string[] = [];
  try {
    const params = new URL(platformUrl).searchParams;
    for (const key of ["drawer.scenarioRunId", "openRun"]) {
      const value = params.get(key);
      if (value) ids.push(value);
    }
  } catch {
    /* non-absolute / malformed — the primaryId key still applies */
  }
  return ids;
}

/**
 * Id fields an item legitimately answers to when the agent names it — the
 * item's own identity plus the parent ids the platform echoes on it. Kept to
 * a short allowlist so arbitrary payload strings never become navigate keys.
 */
const ITEM_ID_KEYS = ["id", "scenarioRunId", "batchRunId", "runId"] as const;

/**
 * Every `{id, href}` pair a payload's NESTED objects surface — a LIST returns
 * many resources in one call, each carrying its own `platformUrl`. Without
 * this, only the single-resource shape (digest primaryId + top-level link)
 * was remembered, so "list runs" → "open the latest one" resolved nothing and
 * the navigate silently dropped. Depth-capped defensive walk; only precise
 * per-resource links qualify, and only allowlisted id fields key them.
 */
function collectItemPlatformLinks(
  payload: unknown,
): Array<{ id: string; href: string }> {
  const links = new Map<string, string>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const href = typeof obj.platformUrl === "string" ? obj.platformUrl : null;
    if (href && isPreciseResourceHref(href)) {
      for (const id of nestedResourceIds(href)) links.set(id, href);
      for (const key of ITEM_ID_KEYS) {
        const value = obj[key];
        if (typeof value === "string" && value) links.set(value, href);
      }
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return Array.from(links, ([id, href]) => ({ id, href }));
}

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
  appendNavigate(a: {
    conversationId: string;
    turnId: string;
    href: string;
  }): Promise<void>;
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
  /**
   * Read the runToken the worker was handed at dispatch, straight from the
   * synchronous per-turn Redis handoff. This is the EXACT token the manager
   * signs its frames with, written before dispatch — so a first frame that
   * outruns the async `RunToken` projection is authenticated instead of dropped
   * as `no-run-token`. Returns null when no handoff exists (aged out past its
   * TTL, or a legacy conversation with no token).
   *
   * `projectId` is REQUIRED, not decorative: the handoff key is
   * conversation+turn scoped, but conversation identity is project-scoped
   * (`@@unique([projectId, ConversationId])`), so the implementation must refuse
   * a handoff stashed under a different project rather than hand this stream
   * another tenant's runToken. Optional dep so unit tests can exercise the
   * projection fallback in isolation.
   */
  readHandoffRunToken?(a: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<string | null>;
  /**
   * Per-conversation memory of "which platform address did a lookup surface for
   * resource X". A `navigate` instruction resolves its destination from here.
   * Conversation-scoped (not this relay instance) so a resource looked up in one
   * turn resolves a navigate in a LATER turn — the relay itself is per-turn.
   */
  resourceLinks: LangyResourceLinkStore;
  /**
   * Verified server-side fallback when the link store misses: the platform
   * looks the id up with the PROJECT's own access and computes the address
   * itself (see langyNavigateFallback). Null = not resolvable here → the
   * navigate drops. Optional so tests and non-navigating consumers stay thin.
   */
  resolveResourceUrl?: (a: {
    projectId: string;
    resourceId: string;
  }) => Promise<string | null>;
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

  // The platform's own link for every resource a lookup surfaced, keyed by the
  // resource id, is remembered in `deps.resourceLinks` — a per-CONVERSATION
  // Redis store, NOT an instance field. The relay is per-turn; a navigate in a
  // later turn must still resolve a link a lookup surfaced in an earlier one.

  constructor(private readonly deps: LangyTurnRelayDeps) {}

  async handle(raw: unknown): Promise<LangyRelayOutcome> {
    const envelopeParse = langyFrameEnvelopeSchema.safeParse(raw);
    if (!envelopeParse.success) {
      return this.reject({ reason: "malformed-envelope" });
    }
    const envelope = envelopeParse.data;

    // Authenticity FIRST — no field is trusted until the MAC checks out. The
    // runToken is looked up by the (as-yet-unverified) conversationId; a wrong
    // conversationId simply yields a token the MAC won't match against.
    const runToken = await this.loadRunToken({
      conversationId: envelope.conversationId,
      projectId: envelope.projectId,
      turnId: envelope.turnId,
    });
    if (runToken === null) {
      return this.reject({ reason: "no-run-token", envelope });
    }
    if (!verifyFrame(runToken, envelope)) {
      return this.reject({ reason: "bad-signature", envelope });
    }

    // Pin to THIS connection's conversation+turn (turnId is now authenticated).
    // The first verified frame pins; any later frame from a different turn is a
    // cross-turn replay and is refused.
    if (!this.checkTurn(envelope)) {
      return this.reject({ reason: "wrong-turn", envelope });
    }

    // Intra-turn replay: a redelivered/duplicated frameNonce is dropped.
    const fresh = await this.deps.reserveFrameNonce({
      conversationId: envelope.conversationId,
      turnId: envelope.turnId,
      frameNonce: envelope.frameNonce,
    });
    if (!fresh) return { status: "duplicate" };

    const frameParse = langyRelayFrameSchema.safeParse(safeJson(envelope.payload));
    if (!frameParse.success) {
      return this.reject({ reason: "invalid-payload", envelope });
    }

    return this.apply(envelope, frameParse.data);
  }

  private async loadRunToken({
    conversationId,
    projectId,
    turnId,
  }: {
    conversationId: string;
    projectId: string;
    turnId: string;
  }): Promise<string | null> {
    // Cache only a REAL token. A null from a transient projection lag must NOT
    // be cached: the old `=== undefined` guard cached the null and dropped every
    // subsequent frame on the connection as no-run-token (prod: a first turn lost
    // its whole first ~5 minutes of progress frames).
    if (this.runToken != null) return this.runToken;

    // Synchronous source first: the per-turn handoff carries the EXACT token the
    // worker signed with, written before dispatch — so the first frames of a
    // brand-new conversation (whose RunToken projection is still queued) are
    // authenticated instead of dropped.
    let fromHandoff: string | null | undefined;
    try {
      fromHandoff = await this.deps.readHandoffRunToken?.({
        projectId,
        conversationId,
        turnId,
      });
    } catch (error) {
      // Falling THROUGH to the projection is the entire point of the two-stage
      // lookup, so a transient Redis blip on this hot path must not propagate
      // out of handle() and tear down the whole relay stream.
      this.deps.logger?.warn(
        {
          projectId,
          conversationId,
          turnId,
          error: error instanceof Error ? error.message : String(error),
        },
        "langy relay handoff runToken read failed; falling back to the projection",
      );
      fromHandoff = null;
    }
    if (fromHandoff) {
      this.runToken = fromHandoff;
      return fromHandoff;
    }

    // Fallback: the durable RunToken projection. Covers a handoff that aged out
    // past its TTL on a very long turn, and keeps working when no handoff dep is
    // wired (unit tests).
    const fromProjection = await this.deps.conversations.getRunToken({
      projectId,
      conversationId,
    });
    if (fromProjection) this.runToken = fromProjection;
    return fromProjection;
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

      case "tool": {
        // A SOLE `langwatch navigate open <resourceId>` call is not a lookup —
        // it is the agent naming WHICH already-surfaced resource to open. It
        // never becomes a visible tool card or a durable event (live-only,
        // see `resourceLinks`); everything else goes through the normal path.
        const invocation = this.soleNavigateInvocationOf(frame);
        if (invocation) {
          return this.applyNavigateTool(projectId, at, frame, invocation);
        }

        // The model sometimes CHAINS the navigate onto its lookup
        // (`…get X --format json && langwatch navigate open X`). The chained
        // call keeps its normal life — card, durable record; the other
        // segments are real work — but each navigate segment still fires:
        // the id comes from the command string and the address only ever
        // from the link store, so compound stdout changes nothing here.
        // (Remembering stays sole-invocation-gated — stdout provenance.)
        if (frame.phase === "end" && !frame.isError) {
          for (const chained of this.chainedNavigateInvocationsOf(frame)) {
            await this.applyNavigateTool(projectId, at, frame, chained);
          }
        }
        return this.applyTool(projectId, at, frame);
      }

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

    // Remember this resource's platform link — the ONLY thing a later
    // `navigate` instruction may resolve an address from. Only from a
    // settled, successful call (so a resource the viewer's own access could
    // not reach never lands here); only when the call was a SOLE plain
    // `langwatch` invocation, so its stdout is provably the CLI's own output
    // and not something the agent chained in (`langwatch trace get x; echo
    // '{…forged…}'` must never seed a navigation target); and only when the
    // link addresses this ONE resource rather than degrading to a surface's
    // bare index (a scenario run whose set could not be resolved, say) — an
    // index must never be cached as if it were the resource's own address.
    if (frame.phase === "end" && !call.isError) {
      const command = this.cliEnvelope.shellCommandOf({
        id: frame.id,
        name: frame.name,
        phase: frame.phase,
        ...(frame.input !== undefined ? { input: frame.input } : {}),
      });
      if (command && isSoleLangwatchInvocation(command)) {
        await this.rememberResourceLink(at, call);
      }
    }

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

  /**
   * Cache a settled call's platform link under the conversation, keyed by the
   * resource it named. Also keys it by any nested resource the URL addresses —
   * a scenario-run link is `…/{batch}?openRun={runId}` whose `digest.primaryId`
   * is the BATCH, but the user opens the RUN; without the extra key
   * `navigate open <runId>` would miss the link that is literally its own
   * address. Every id the link legitimately opens is a valid navigate target.
   */
  private async rememberResourceLink(
    at: { conversationId: string; turnId: string },
    call: LangyToolFrame,
  ): Promise<void> {
    if (!call.result) return;
    const payload = cliToolResultPayload(call.result);

    // Every nested item that carries its own precise link (a LIST surfaces
    // many resources in one call), keyed by each id it answers to.
    const links = new Map(
      collectItemPlatformLinks(payload).map(({ id, href }) => [id, href]),
    );

    // The single-resource shape: the call's digest names the resource, the
    // payload's top-level link addresses it.
    const primaryId = call.digest?.primaryId;
    const platformUrl = extractPlatformUrl(payload);
    if (primaryId && platformUrl && isPreciseResourceHref(platformUrl)) {
      links.set(primaryId, platformUrl);
      for (const id of nestedResourceIds(platformUrl)) {
        links.set(id, platformUrl);
      }
    }

    if (links.size === 0) return;
    await this.deps.resourceLinks.remember({
      conversationId: at.conversationId,
      links: Array.from(links, ([id, href]) => ({ id, href })),
    });
  }

  /**
   * Whether a tool frame is the dedicated `langwatch navigate open
   * <resourceId>` call, and — if so — the resource id it named. Read straight
   * off the parsed shell command, independent of whether the call itself
   * settled successfully: the agent's ONLY input here is which resource, never
   * an address, so there is nothing else to extract.
   */
  private shellCommandOfFrame(
    frame: Extract<LangyRelayFrame, { type: "tool" }>,
  ): string | null {
    return this.cliEnvelope.shellCommandOf({
      id: frame.id,
      name: frame.name,
      phase: frame.phase,
      ...(frame.input !== undefined ? { input: frame.input } : {}),
    });
  }

  /**
   * The frame IS one plain `langwatch navigate open <resourceId>` call and
   * nothing else — the shape the relay intercepts whole (invisible: no card,
   * no durable record).
   */
  private soleNavigateInvocationOf(
    frame: Extract<LangyRelayFrame, { type: "tool" }>,
  ): { resourceId: string } | null {
    const command = this.shellCommandOfFrame(frame);
    if (!command || !isSoleLangwatchInvocation(command)) return null;
    return navigateResourceIdOf(parseLangwatchCommand(command));
  }

  /**
   * Navigate segments riding a COMPOUND command (`…get X && langwatch
   * navigate open X`). The call itself stays on the normal tool path — only
   * the navigation side-effect is read off the command string.
   */
  private chainedNavigateInvocationsOf(
    frame: Extract<LangyRelayFrame, { type: "tool" }>,
  ): Array<{ resourceId: string }> {
    const command = this.shellCommandOfFrame(frame);
    if (!command) return [];
    return parseAllLangwatchCommands(command)
      .map(navigateResourceIdOf)
      .filter((inv): inv is { resourceId: string } => inv !== null);
  }

  /**
   * Resolve a navigate instruction and push it to the live edge — NEVER to the
   * durable log (see `LangyStreamEntry`'s `navigate` variant). Invisible on
   * both counts when it can't resolve: no tool card (the agent naming a
   * resource to open is not a lookup worth its own card) and no navigation
   * (an unknown/unresolvable/inaccessible destination silently drops — the
   * turn is otherwise unaffected).
   */
  private async applyNavigateTool(
    projectId: string,
    at: { conversationId: string; turnId: string },
    frame: Extract<LangyRelayFrame, { type: "tool" }>,
    invocation: { resourceId: string },
  ): Promise<LangyRelayOutcome> {
    if (frame.phase === "start" || frame.isError) return { status: "applied" };

    // The conversation's remembered link first; on a miss, the platform's own
    // verified lookup (project-scoped) — the cache is an optimization, not
    // the source of truth for what the id addresses.
    const platformUrl =
      (await this.deps.resourceLinks.resolve({
        conversationId: at.conversationId,
        id: invocation.resourceId,
      })) ??
      (this.deps.resolveResourceUrl
        ? await this.deps.resolveResourceUrl({
            projectId,
            resourceId: invocation.resourceId,
          })
        : null);
    if (!platformUrl) return { status: "applied" }; // not resolvable in this project — drop

    const href = toRelativeSameOriginHref({
      url: platformUrl,
      origin: env.BASE_HOST ?? "",
    });
    if (!href) return { status: "applied" }; // resolves outside the app — drop

    await this.deps.buffer.appendNavigate({ ...at, href });
    return { status: "applied" };
  }

  private reject({
    reason,
    envelope,
  }: {
    reason: LangyRelayRejection;
    envelope?: Pick<
      LangyFrameEnvelope,
      "conversationId" | "turnId" | "projectId"
    >;
  }): LangyRelayOutcome {
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
