/**
 * LangyTurnService — durable turn admission and dispatch orchestration, lifted out of
 * `routes/langy.ts` (ADR-046).
 *
 * The Hono route now keeps only Phase 1 (session auth, demo gate, rate limit,
 * body validation, project-permission gate) and maps DomainErrors to HTTP. This
 * service owns everything after the gate: resolve the conversation, model,
 * credentials and egress list; probe-then-mint the per-turn session key; reserve
 * the PR permit; guard against a concurrent turn; stash the
 * live-access grant + the worker handoff; and atomically accept the turn. Once
 * accepted, a direct dispatch starts the worker immediately while the process
 * outbox remains the at-least-once recovery path.
 *
 * The ORDER here is load-bearing: gate precedence, the message-before-turn
 * invariant, permit release on early exit, and mint-only-on-a-probe-miss are
 * deliberate. Independent reads and transient Redis writes overlap so they do
 * not add avoidable serial latency to the command path.
 *
 * Errors are thrown as DomainErrors (each carries its httpStatus); the route
 * renders them. Infrastructure failures throw and surface generically.
 */

import { createHash } from "node:crypto";
import type { LangyMessagePart } from "@langwatch/langy";
import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";
import type { LangyCredentialService } from "~/server/app-layer/langy/LangyCredentialService";
import { LangySessionKeyScopeError } from "~/server/app-layer/langy/langyApiKey";
import {
  extractLangyConversationMemory,
  LANGY_REFERENT_POLICY,
  renderLangyConversationMemory,
  renderLangyConversationTranscript,
} from "~/server/app-layer/langy/langyConversationMemory";
import {
  LANGY_PROMPT_HANDLES,
  LANGY_TURN_OVERRIDE_FALLBACK,
  resolveLangyPrompt,
} from "~/server/app-layer/langy/langyPromptRegistry";
import type { LangyTurnContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import { renderLangyTurnContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import type { LangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import type {
  LangyMessageRepository,
  LangyMessageRow,
} from "~/server/app-layer/langy/repositories/langy-message.repository";
import { mintRunToken } from "~/server/app-layer/langy/streaming/langyFrameAuth";
import type { LangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type { LangyTurnAccessStore } from "~/server/app-layer/langy/streaming/langyTurnAccess";
import type { LangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import type { Session } from "~/server/auth";
import { getLangyTurnsCounter } from "~/server/metrics";
import type { PromptService } from "~/server/prompt-config/prompt.service";
import {
  LangyAgentUnavailableError,
  LangyConversationNotOwnedError,
  LangyEmptyMessageError,
  LangyIdempotencyMismatchError,
  LangyInsufficientScopeError,
  LangyModelNotAllowedError,
  LangyModelNotConfiguredError,
  LangyTurnInProgressError,
  LangyTurnNotStoppableError,
} from "./errors";
import type { LangyConversationService } from "./langy-conversation.service";
import { buildFinalAssistantParts } from "./langy-final-parts";
import { extractTextFromParts } from "./langy-message.service";
import { LangyTurnAttempt } from "./langy-turn-attempt";
import { resolveLangyTurnBaseDependencies } from "./langy-turn-base-dependencies";
import type { LangyTurnAdmissionRepository } from "./repositories/langy-turn-admission.repository";

const logger = createLogger("langwatch:langy:turn-service");

/**
 * The Langy system-block override — Langy's role, not a code assistant. The text
 * lives in `langyPromptRegistry` as the in-repo source of truth + registry
 * fallback (ADR-050), so the seed script and the registry loader share the exact
 * same bytes. Aliased here to keep the composition below readable.
 */
const LANGY_OVERRIDE = LANGY_TURN_OVERRIDE_FALLBACK;

/** Which path produced the turn's system-block override. */
type LangyOverrideSource =
  /** No holding project configured — the in-repo constant, no registry call. */
  | "unconfigured"
  /** Read from the promoted registry row. */
  | "registry"
  /** The read FAILED; the last text this process read from the registry. */
  | "cached"
  /** A genuine miss (no row / empty row), or a failure with nothing cached. */
  | "fallback";

export interface ResolvedLangyTurnOverride {
  text: string;
  source: LangyOverrideSource;
}

/**
 * The last override text a registry read actually returned, held for the life
 * of the process.
 *
 * It exists because the system lane is the provider's CACHE PREFIX and must
 * stay byte-identical across a conversation's turns (see the composition site
 * in `startConversationTurn`). Without this, a single Prisma timeout on turn 5
 * of a conversation whose turns 1-4 used the promoted text would silently swap
 * the model's system instructions AND pay a full prefix rewrite at the write
 * premium — a transient blip mutating a live conversation.
 *
 * The full matrix, and only a read ERROR reuses this:
 *
 *  - `registry` — a promoted row was read: use it, and STORE it as last-good.
 *  - `fallback` — a genuine miss (row demoted, deleted or blank): use the
 *    in-repo constant, and CLEAR last-good. The clear is the load-bearing half:
 *    without it the text an operator deliberately removed stays held for the
 *    life of the process, and the next transient read failure serves it back
 *    out of this cache — resurrecting demoted content indefinitely.
 *  - `error`    — a transient failure: reuse last-good if we hold one, else the
 *    in-repo constant.
 *
 * So the cache only ever holds text the registry is currently serving, and a
 * demotion is honoured from the turn that observed it onwards — not just on
 * that one call.
 */
let lastRegistryOverrideText: string | null = null;

/**
 * The system-block override for this turn: the promoted registry row when an
 * operator has configured the project that holds Langy's prompts, else the
 * in-repo constant.
 *
 * The project id is read from `LANGY_PROMPT_PROJECT_ID` — the SAME variable
 * `scripts/seed-langy-prompts.ts` seeds into, so "seed it, promote it, set the
 * id" is one coherent operation rather than two halves that never met.
 * Unconfigured is the default and costs nothing: no prompt service call, no
 * database round trip on the turn path.
 *
 * When configured it DOES cost round trips (`getPromptByIdOrHandle` resolves
 * the org before reading the config), which is why the caller starts this
 * alongside the other conversation-scoped reads instead of awaiting it on its
 * own — see the overlapped batch in `startConversationTurn`.
 *
 * Returns the `source` as well as the text so the caller can record which path
 * a turn took; a swap must be observable, not warn-log-only.
 */
async function resolveLangyTurnOverride(
  deps: Pick<LangyTurnServiceDeps, "prompts">,
): Promise<ResolvedLangyTurnOverride> {
  const projectId = process.env.LANGY_PROMPT_PROJECT_ID?.trim();
  if (!projectId || !deps.prompts) {
    return { text: LANGY_OVERRIDE, source: "unconfigured" };
  }

  const resolved = await resolveLangyPrompt({
    promptService: deps.prompts,
    projectId,
    handle: LANGY_PROMPT_HANDLES.turnOverride,
    fallback: LANGY_OVERRIDE,
  });
  if (resolved.source === "registry") {
    lastRegistryOverrideText = resolved.text;
    return { text: resolved.text, source: "registry" };
  }
  if (resolved.source === "error") {
    if (lastRegistryOverrideText !== null) {
      return { text: lastRegistryOverrideText, source: "cached" };
    }
    return { text: resolved.text, source: "fallback" };
  }
  // A genuine miss: the row is gone, demoted or blank. Drop the held text so a
  // later blip cannot serve back what the operator removed.
  lastRegistryOverrideText = null;
  return { text: resolved.text, source: "fallback" };
}

/**
 * Test seam ONLY: drop the process-held registry text so one test's successful
 * read cannot leak into the next test's blip. Never called in production — the
 * cache is meant to outlive every turn the process serves.
 */
export function __resetLangyTurnOverrideCacheForTests(): void {
  lastRegistryOverrideText = null;
}

/**
 * Turn identity binds the client's idempotency key to WHO sent it and WHAT was
 * sent. Three properties fall out structurally:
 *
 * - a transport retry (same user, same key, same content) derives the same id
 *   and collapses onto the admitted turn;
 * - the same key with DIFFERENT content derives a different id, which the
 *   admission receipt exposes as a mismatch instead of silently replaying the
 *   original send;
 * - two users can never mint the same turn id, whatever keys they choose.
 *
 * The hash input uses the zod-parsed messages verbatim: a retry is the same
 * client re-serializing the same payload, so byte-stable JSON is a fair
 * equality. Semantic reordering counts as different content — by design.
 */
export function langyTurnIdentity(input: {
  userId: string;
  idempotencyKey: string;
  messages: unknown;
  modelOverride?: string;
}): { turnId: string; messageId: string } {
  const digest = createHash("sha256")
    .update(input.userId)
    .update("\u0000")
    .update(input.idempotencyKey)
    .update("\u0000")
    .update(JSON.stringify(input.messages))
    .update("\u0000")
    .update(input.modelOverride ?? "")
    .digest("hex")
    .slice(0, 32);
  return { turnId: `langyturn_${digest}`, messageId: `langymsg_${digest}` };
}

/**
 * The label that marks where the user's own words start inside a composed
 * prompt. Everything before it is control-plane-authored DATA (screen context,
 * the turn-scoped cap note) or, on a fresh session's first post, the
 * manager-folded history seed; everything after it is the user speaking.
 */
export const LANGY_USER_MESSAGE_LABEL = "THE USER'S MESSAGE:";

/**
 * `scenarios:create` → "create scenarios": the action verb in the words a
 * customer already uses, then the resource. This is the AGENT-PROMPT twin of the
 * card-side `humanPermission` (langyToolFailure.ts) — deliberately independent,
 * because one addresses the model composing a reply and the other a user reading
 * a card, and coupling them across the server/client boundary would be worse
 * than a few lines of parallel formatting.
 */
const LANGY_PERMISSION_ACTION_WORDS: Record<string, string> = {
  view: "view",
  create: "create",
  update: "edit",
  delete: "delete",
  manage: "manage",
  share: "share",
};

// Resources whose slug is not the word the customer uses. `evaluations` is the
// online-evaluation (monitor) family — "evaluations" alone reads as the broader
// concept, so name it the way the product does. Everything else humanizes fine
// from its slug (scenarios, datasets, prompts, …).
const LANGY_PERMISSION_RESOURCE_LABELS: Record<string, string> = {
  evaluations: "online evaluations",
};

function humanizeLangyPermission(permission: string): string {
  const [resource, action] = permission.split(":");
  const verb = (action ? LANGY_PERMISSION_ACTION_WORDS[action] : "") ?? action;
  const noun =
    (resource ? LANGY_PERMISSION_RESOURCE_LABELS[resource] : "") ??
    (resource ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]/g, " ")
      .toLowerCase();
  return verb ? `${verb} ${noun}`.trim() : noun;
}

/**
 * The per-turn "access you lack" note, or "" when the caller holds everything
 * Langy uses (so it is dropped from the prompt, exactly like the cap note).
 *
 * It rides the USER message, not the system lane, because it is per-caller and
 * per-project and so would break the cached prefix (see `composeLangyTurnPrompt`
 * and `startConversationTurn`). It names each missing access in plain words AND
 * carries the raw permission slug, so the model can both phrase the refusal
 * nicely and quote the exact access if the user asks which one. See
 * {@link resolveLangyMissingPermissions} for how the list is derived.
 */
export function renderLangyMissingPermissionsNote(
  missing: readonly string[],
): string {
  if (missing.length === 0) return "";
  const phrases = missing.map(
    (p) => `${humanizeLangyPermission(p)} (\`${p}\`)`,
  );
  return [
    "ACCESS THE PERSON YOU ACT FOR DOES NOT HOLD IN THIS PROJECT —",
    "they cannot:",
    `${phrases.join("; ")}.`,
    "Do NOT run any command that needs one of these; it will be refused.",
    "If they ask for one, tell them plainly — in their own words, not the slug",
    "— that they don't have access to do it in this project, and stop. Never",
    'run the command "to check", and never retry it with fewer arguments.',
  ].join(" ");
}

/**
 * Compose the turn's user-message prompt.
 *
 * A bare ask stays a bare ask: when nothing is (or could be) prepended, the
 * prompt is exactly the user's text, as it always was. The moment anything
 * rides ahead of it (the screen-context block, the cap note, the access-you-
 * lack note, or a history seed the manager may fold in), the ask is set apart
 * under {@link LANGY_USER_MESSAGE_LABEL} so no prepended DATA can blur into the
 * user's own words. `hasHistorySeed` exists because the SEED is prepended by
 * the worker manager, not here: the label must already be in place on the
 * wire for the composition the manager may produce.
 *
 * Volatile content lives HERE, in the message, and never in the system
 * parameter: the system lane must stay byte-identical across a conversation's
 * turns for provider prompt caching to read the prefix instead of re-writing
 * it (see the composition site in `startConversationTurn`).
 */
export function composeLangyTurnPrompt({
  contextBlock,
  capNote,
  permissionsNote,
  hasHistorySeed,
  userText,
}: {
  contextBlock: string | null;
  capNote: string;
  permissionsNote: string;
  hasHistorySeed: boolean;
  userText: string;
}): string {
  const preamble = [contextBlock, capNote, permissionsNote]
    .map((block) => (block ?? "").trim())
    .filter((block) => block.length > 0);
  if (preamble.length === 0 && !hasHistorySeed) return userText;
  return [...preamble, `${LANGY_USER_MESSAGE_LABEL}\n${userText}`].join("\n\n");
}

export interface LangyChatMessageInput {
  role: "user" | "assistant" | "system";
  parts: LangyMessagePart[];
}

export interface StartConversationTurnInput {
  projectId: string;
  /** Stable identity for one logical send, reused by every transport retry. */
  idempotencyKey: string;
  session: Session;
  /** The client-supplied conversation id, or null to mint a fresh one. */
  requestedConversationId: string | null;
  messages: LangyChatMessageInput[];
  modelOverride?: string;
  /** A regenerate re-drives the last turn against the message already on record. */
  isRetry: boolean;
  /** Composer context chips (page context + skills), rendered into the system block. */
  turnContext: LangyTurnContext;
}

export interface LangyTurnServiceDeps {
  conversations: LangyConversationService;
  credentials: LangyCredentialService;
  /**
   * Reads Langy's versioned prompts (ADR-050). Optional: absent (tests, and any
   * composition that has not wired it) means the in-repo fallback text, which
   * is also what a configured-but-empty registry yields.
   */
  prompts?: Pick<PromptService, "getPromptByIdOrHandle">;
  /**
   * Resolve the project's configured Langy model; rejects when none is
   * configured. The returned `modelId` is the full provider-prefixed id and
   * is FORWARDED to the worker (ADR-065) — with no per-send override, the
   * turn runs on this model, never on the worker's own built-in default.
   */
  resolveModel: (args: { projectId: string }) => Promise<{ modelId: string }>;
  /** Direct fast-path dispatch plus durable process-effect recovery. `cancel`
   * is the best-effort worker abort behind a user Stop (ADR-078). */
  worker: Pick<LangyWorkerPort, "probe" | "dispatch" | "cancel"> | null;
  /**
   * The durable token buffer (ADR-044). A user Stop reads its `delta` tail to
   * reconstruct the partial answer as the source of truth, then `markEnd`s it so
   * every attached browser's live stream settles. Null where there is no Redis.
   */
  tokenBuffer: Pick<LangyTokenBuffer, "readTail" | "markEnd"> | null;
  reservePermit: (args: { userId: string }) => Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }>;
  releasePermit: (args: { userId: string }) => Promise<void>;
  perDayPrCap: number;
  /** Mint the per-turn session key (prisma pre-bound at composition). */
  mintSessionKey: (args: {
    session: Session;
    projectId: string;
    organizationId: string;
  }) => Promise<{ token: string; apiKeyId: string }>;
  /**
   * The Langy access the caller does NOT hold in this project, resolved fresh
   * each turn so the assistant can be told up front what to decline rather than
   * attempting-then-looping (prisma pre-bound at composition). A failed resolve
   * is never fatal — the turn runs without the note, degraded, not broken.
   */
  resolveMissingPermissions: (args: {
    session: Session;
    projectId: string;
    organizationId: string;
  }) => Promise<string[]>;
  revokeSessionKey: (args: {
    apiKeyId: string;
    projectId: string;
  }) => Promise<void>;
  admission: LangyTurnAdmissionRepository;
  accessStore: LangyTurnAccessStore | null;
  handoffStore: LangyTurnHandoffStore | null;
  /**
   * The conversation's durable messages, read so a follow-up turn can be told
   * what earlier turns of the SAME conversation created (see
   * `langyConversationMemory` for why the agent cannot be relied on to remember
   * it). Null where there is no projection, and a failed read is never fatal —
   * a turn without its memory is degraded, not broken.
   */
  messages: Pick<LangyMessageRepository, "findAllByConversation"> | null;
}

/**
 * Reconstruct the partial answer text from the durable buffer's `delta` entries
 * (ADR-078). The buffer batches deltas and flushes its tail on `markEnd`, so this
 * is the durable truth up to the last flush; a handful of un-flushed words still
 * in the worker's memory are not the control plane's to see, and "the partial is
 * preserved" does not require them. Non-`delta` entries (status, reasoning, tool,
 * plan, terminals) are not answer text and are skipped.
 */
async function reconstructPartialAnswer(
  tokenBuffer: Pick<LangyTokenBuffer, "readTail">,
  { conversationId, turnId }: { conversationId: string; turnId: string },
): Promise<string> {
  const { reads } = await tokenBuffer.readTail({ conversationId, turnId });
  let text = "";
  for (const { entry } of reads) {
    if (entry.type === "delta") text += entry.text;
  }
  return text;
}

export class LangyTurnService {
  private constructor(private readonly deps: LangyTurnServiceDeps) {}

  static create(deps: LangyTurnServiceDeps): LangyTurnService {
    return new LangyTurnService(deps);
  }

  /**
   * Stop an in-flight turn FOR REAL (ADR-078). The browser's `useChat` stop only
   * aborts its own subscription; this ends the turn on the durable record — the
   * confirmation — and only then, best-effort, asks the worker to abandon the
   * generation. The order matters: the truthful stop must not depend on a live,
   * responsive worker.
   *
   *   1. reconstruct the partial answer from the durable buffer's `delta` tail
   *      (the source of truth, refresh-safe — never whatever the browser painted);
   *   2. record `agent_responded { outcome: "stopped" }` on the shared
   *      turn-terminal slot, so a stop racing a natural finish collapses to
   *      exactly one terminal and the partial is preserved as the assistant
   *      message that anchors a later Continue;
   *   3. `markEnd` the buffer so every attached browser's live stream settles out
   *      of its spinner;
   *   4. best-effort `worker.cancel` to stop the token burn.
   *
   * Idempotent by construction: if the turn already reached a terminal, the
   * terminal command collapses at the store (first-writer-wins) and steps 3–4 are
   * harmless no-ops — a Stop clicked a beat too late leaves the finished answer
   * intact.
   *
   * The control gate is stricter than watching a turn: only the turn's actor or
   * the conversation owner may stop it, never a shared viewer. A caller who may
   * not control it gets a handled `LangyConversationNotOwnedError` (403). An
   * owner who is not the actor must additionally name the turn the record has in
   * flight — see the guard below for why an unproven id may not write a
   * terminal (`LangyTurnNotStoppableError`, 409).
   */
  async stopTurn({
    projectId,
    conversationId,
    turnId,
    userId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<void> {
    const { tokenBuffer, worker, conversations, accessStore } = this.deps;

    const isActor = accessStore
      ? await accessStore.isTurnActor({
          projectId,
          conversationId,
          turnId,
          userId,
        })
      : false;
    if (!isActor) {
      const conv = await conversations.findByIdVisible({
        id: conversationId,
        projectId,
        userId,
      });
      if (!conv?.isOwn) {
        throw new LangyConversationNotOwnedError(conversationId);
      }
      // The turn id is client input, and a stop is the one place it buys a
      // DURABLE terminal — an assistant message and a conversation returned to
      // idle. The turn's own actor already proved the turn exists under this
      // conversation (the live-access grant is written before the turn is
      // accepted, so it cannot lag). An owner who is NOT the actor has proved
      // nothing about the id, so it must be the turn the record has in flight;
      // otherwise a bogus id would terminate — or fabricate an answer on — a
      // turn that is not running. The sibling `agent_response_failed` fold has
      // carried exactly this guard all along.
      if (conv.currentTurnId !== turnId) {
        throw new LangyTurnNotStoppableError(turnId);
      }
    }

    const partialText = tokenBuffer
      ? await reconstructPartialAnswer(tokenBuffer, { conversationId, turnId })
      : "";

    // The durable terminal — this write IS the "real backend confirmation".
    await conversations.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: buildFinalAssistantParts({ text: partialText }),
      outcome: "stopped",
    });

    // End the stream and chase the token burn. Both are best-effort and
    // independent of the durable terminal above; neither may throw back into the
    // mutation, and a wedged worker must not delay the stop the user already got.
    await Promise.allSettled([
      tokenBuffer?.markEnd({ conversationId, turnId }) ?? Promise.resolve(),
      worker?.cancel({ conversationId, turnId, projectId }) ??
        Promise.resolve(),
    ]);
  }

  /**
   * Start (or continue) an agent turn on a conversation. Returns the ids the
   * client subscribes with. A relocation of the route's Phases 2–N — see the
   * file header for why the ordering is exact.
   */
  async startConversationTurn(
    input: StartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    const {
      projectId,
      idempotencyKey,
      session,
      requestedConversationId,
      messages,
      modelOverride,
      isRetry,
      turnContext,
    } = input;
    const userId = session.user.id;
    const { worker, accessStore, handoffStore } = this.deps;

    // Env / infra preconditions the route used to 503 on.
    if (!worker) {
      throw new LangyAgentUnavailableError("Agent not configured");
    }
    if (!accessStore || !handoffStore) {
      throw new LangyAgentUnavailableError();
    }

    // Reject content-free sends BEFORE anything durable happens: an admitted
    // empty turn is one the agent can only 422, and a permanently rejected
    // dispatch used to poison the process outbox with endless retries.
    const lastUserMessage = messages[messages.length - 1];
    const userText = extractTextFromParts(lastUserMessage?.parts);
    if (!userText.trim()) {
      // Self-report like every other rejection branch — without this the
      // empty-send path is invisible in the turn-outcome metric.
      getLangyTurnsCounter("rejected").inc();
      throw new LangyEmptyMessageError();
    }

    const identity = langyTurnIdentity({
      userId,
      idempotencyKey,
      messages,
      ...(modelOverride ? { modelOverride } : {}),
    });

    const conversationService = this.deps.conversations;
    const credentialService = this.deps.credentials;

    const { speculativeConversation, credentials, resolvedModel } =
      await resolveLangyTurnBaseDependencies({
        deps: this.deps,
        projectId,
        userId,
        session,
        requestedConversationId,
        ...(modelOverride ? { modelOverride } : {}),
      });

    // The model this turn runs on: the per-send override when the user picked
    // one, the project's configured Langy model otherwise. Forwarded to the
    // worker on every path (probe, handoff, dispatch) so the worker never
    // falls back to its own built-in default (ADR-065).
    const turnModel = modelOverride ?? resolvedModel;
    if (!turnModel) {
      throw new LangyModelNotConfiguredError();
    }

    // The receipt and active-turn row are the authoritative admission boundary.
    // Stable ids make every sibling write and every later request replay collapse
    // to the same logical send.
    const admission = await this.deps.admission.claim({
      projectId,
      userId,
      idempotencyKey,
      conversationId: speculativeConversation.id,
      turnId: identity.turnId,
    });
    if (admission.kind === "mismatch") {
      getLangyTurnsCounter("mismatch").inc();
      throw new LangyIdempotencyMismatchError();
    }
    if (admission.kind === "replay") {
      getLangyTurnsCounter("replay").inc();
      return {
        conversationId: admission.conversationId,
        turnId: admission.turnId,
      };
    }
    if (admission.kind === "pending") {
      getLangyTurnsCounter("rejected").inc();
      throw new LangyAgentUnavailableError(
        "This turn is already being prepared. Please retry shortly.",
      );
    }
    if (admission.kind === "busy") {
      getLangyTurnsCounter("busy").inc();
      throw new LangyTurnInProgressError();
    }

    // Enrich the ACTIVE span (the tRPC procedure span on the fast path, the
    // outbox consumer span on recovery) rather than opening a new one: the ids
    // are what make a turn findable in the trace store, and one enriched span
    // beats another layer of nesting on an already-deep trace.
    trace.getActiveSpan()?.setAttributes({
      "tenant.id": projectId,
      "langy.conversation.id": admission.conversationId,
      "langy.turn.id": admission.turnId,
      "user.id": userId,
    });

    const conversation = {
      id: admission.conversationId,
      // An expired retry receipt may replace the speculative fresh id with the
      // original one. That original was also a new conversation.
      isNew:
        speculativeConversation.isNew ||
        speculativeConversation.id !== admission.conversationId,
    };
    const turnId = admission.turnId;
    const attempt = new LangyTurnAttempt(
      {
        projectId,
        userId,
        idempotencyKey,
        conversationId: conversation.id,
        turnId,
        claimToken: admission.claimToken,
      },
      this.deps,
    );

    try {
      const questionParts = lastUserMessage?.parts ?? [];
      const title =
        extractTextFromParts(messages[0]?.parts).slice(0, 80) || null;

      // The per-conversation frame-signing key is created from resolved
      // conversation state, never from a caller-supplied "new" flag.
      const mintedRunToken = conversation.isNew ? mintRunToken() : null;

      const probeWorker = () =>
        worker.probe({
          projectId,
          actorUserId: userId,
          conversationId: conversation.id,
          // The model is part of the worker signature, so a model change —
          // override or configured default — is a probe MISS and the worker
          // re-provisions rather than running on the model it booted with.
          model: turnModel,
          hasGithubAuth: !!credentials.githubToken,
          ...(credentials.githubRepoScopeKey
            ? { githubRepoScopeKey: credentials.githubRepoScopeKey }
            : {}),
          ...(credentials.egressAllowlist
            ? { egressAllowlist: credentials.egressAllowlist }
            : {}),
          // ADR-061 mirror tier is part of the worker signature, so a tier
          // change must be a probe MISS (re-warm) rather than a stale mirror.
          ...(credentials.mirrorTier
            ? { mirrorTier: credentials.mirrorTier }
            : {}),
        });

      // With no GitHub capability, the signature is already final; overlap the
      // cheap probe with the conversation-scoped reads.
      const earlyWorkerProbe = credentials.githubToken ? null : probeWorker();

      const [
        currentResult,
        handoffResult,
        runTokenResult,
        modelsAllowedResult,
        memoryResult,
        missingPermissionsResult,
        overrideResult,
      ] = await Promise.allSettled([
        conversationService.findByIdVisible({
          id: conversation.id,
          projectId,
          userId,
        }),
        conversationService.getPendingHandoff({
          projectId,
          conversationId: conversation.id,
        }),
        mintedRunToken
          ? Promise.resolve(mintedRunToken)
          : conversationService.getRunToken({
              projectId,
              conversationId: conversation.id,
            }),
        credentialService.getModelsAllowed({
          projectId,
          organizationId: credentials.organizationId,
        }),
        // The conversation's own history. Overlapped with the reads above so
        // remembering costs no extra latency window. A fresh conversation has
        // nothing to read, so it does not pay for the round trip either. The
        // OWNERSHIP gate is already behind us: `ensureConversation` accepted
        // this id only because this user owns it.
        conversation.isNew || !this.deps.messages
          ? Promise.resolve<LangyMessageRow[]>([])
          : this.deps.messages.findAllByConversation({
              conversationId: conversation.id,
              projectId,
            }),
        // The access the caller does NOT hold, so the turn can tell the
        // assistant up front what to decline instead of attempting-then-looping.
        // Overlapped with the reads above (no extra latency window); a failed
        // resolve just omits the note (see below), never fails the turn.
        this.deps.resolveMissingPermissions({
          session,
          projectId,
          organizationId: credentials.organizationId,
        }),
        // The system-block override (ADR-050). It depends on nothing computed
        // after `resolveLangyTurnBaseDependencies`, so it belongs in this
        // batch: awaiting it on its own at the composition site put two serial
        // Prisma round trips (`getPromptByIdOrHandle` resolves the org, then
        // reads the config) in front of time-to-first-token on EVERY turn, for
        // a value that is the same for every tenant. Unconfigured (the default)
        // resolves synchronously and costs nothing here either.
        resolveLangyTurnOverride(this.deps),
      ]);

      // The runToken IS the frame-signing key, and a turn without one is
      // refused here. Be precise about what that buys and what it costs.
      //
      // WITHOUT the token the turn does NOT hang. The worker's relay client
      // returns `ErrRelayDisabled` for an empty runToken
      // (`adapters/controlplane/relay.go`), so no frame is ever signed with an
      // empty key and none is ever rejected on the verify side; `frameSink`
      // simply runs with a nil stream. The turn executes to completion and
      // `finalizeCompletedTurn` posts the durable final to
      // `/api/internal/langy` unconditionally. The user still gets their
      // answer — it just lands in one piece at the end, with no live stream to
      // watch, no progress, and no Stop.
      //
      // WHY REFUSE ANYWAY: silently downgrading a turn to no-live-edge is not
      // the product. The panel is built around a stream the user can watch and
      // stop, and a conversation that has lost its signing key will stay lost
      // for every following turn. A card the user can act on beats an
      // indefinite spinner that resolves minutes later, or a Stop button that
      // does nothing.
      //
      // WHAT IT COSTS, plainly: `langyRecoveryPolicy` classifies
      // `langy_agent_unavailable` as terminal with no auto-retry. So a
      // transient Postgres blip on the `getRunToken` read now ends as a dead
      // "unavailable" card and NO answer, where the degraded path would have
      // delivered one. We take that trade deliberately — never a half-visible
      // turn, at the price of a hard fail on a read blip — and it is the
      // reason to keep this branch loud in the logs.
      if (runTokenResult.status === "rejected") {
        logger.error(
          {
            error: runTokenResult.reason,
            projectId,
            conversationId: conversation.id,
            turnId,
          },
          "could not read the langy runToken; refusing to start an unsignable turn",
        );
        throw new LangyAgentUnavailableError("Agent request failed");
      }
      const runToken = runTokenResult.value;
      if (!runToken) {
        logger.error(
          { projectId, conversationId: conversation.id, turnId },
          "langy conversation has no runToken; refusing to start an unsignable turn",
        );
        throw new LangyAgentUnavailableError("Agent request failed");
      }

      // The project's Langy allowlist is the ONLY runnable-set gate, and it
      // covers the effective model on BOTH paths — a per-send override and
      // the configured default alike — so a disallowed model is a clean card
      // at turn start, never a mid-turn gateway rejection. The engine itself
      // is provider-blind: whatever passes here is dispatched with its full
      // provider-prefixed id and the gateway's prefix routing picks the
      // provider.
      if (modelsAllowedResult.status === "rejected") {
        throw modelsAllowedResult.reason;
      }
      const modelsAllowed = modelsAllowedResult.value;
      if (modelsAllowed && !modelsAllowed.includes(turnModel)) {
        logger.warn(
          { projectId, turnModel, allowedCount: modelsAllowed.length },
          "turn model not in VK allowlist — rejecting",
        );
        throw new LangyModelNotAllowedError(turnModel);
      }

      // Projection read is only a rollout/back-compat hint. The Postgres
      // admission claim above is the concurrency authority.
      const current =
        currentResult.status === "fulfilled" ? currentResult.value : null;
      if (currentResult.status === "rejected") {
        logger.warn(
          { error: currentResult.reason, conversationId: conversation.id },
          "busy projection read failed after authoritative admission",
        );
      }
      if (current?.status === LANGY_CONVERSATION_STATUS.RUNNING) {
        throw new LangyTurnInProgressError();
      }

      const permit = credentials.githubToken
        ? await this.deps.reservePermit({ userId })
        : { reserved: false, allowed: true, resetAt: 0 };
      attempt.retainPermit(permit.reserved);
      const capReachedNote = !permit.allowed
        ? [
            "",
            "USER PR CAP REACHED — the user has already opened the per-day maximum",
            "of",
            String(this.deps.perDayPrCap),
            "GitHub pull requests via Langy today.",
            "If the user asks you to open a PR, refuse politely, say the daily cap",
            "is reached, and that it resets at",
            new Date(permit.resetAt).toISOString(),
            "UTC.",
            "Do not call any tool that opens a PR.",
          ].join(" ")
        : "";
      if (!permit.allowed) {
        delete (credentials as { githubToken?: string }).githubToken;
        delete (credentials as { githubLogin?: string }).githubLogin;
      }

      const workerIsLive = await (earlyWorkerProbe ?? probeWorker());

      if (!workerIsLive) {
        const minted = await this.deps.mintSessionKey({
          session,
          projectId,
          organizationId: credentials.organizationId,
        });
        credentials.langwatchApiKey = minted.token;
        credentials.langwatchApiKeyId = minted.apiKeyId;
        attempt.retainSessionKey(minted.apiKeyId);
      }

      // A turn that cannot read its own history still runs — degraded, and said
      // so once in the logs, rather than 500ing over a memory aid.
      if (memoryResult.status === "rejected") {
        logger.warn(
          { error: memoryResult.reason, conversationId: conversation.id },
          "failed to read langy conversation memory — the turn runs without it",
        );
      }
      const durableMessages =
        memoryResult.status === "fulfilled" ? memoryResult.value : [];
      const conversationTranscript = renderLangyConversationTranscript({
        messages: durableMessages,
        currentPrompt: userText,
      });
      const conversationMemory = renderLangyConversationMemory(
        extractLangyConversationMemory({ messages: durableMessages }),
      );

      // THE SPLIT IS THE POINT (provider prompt caching). The system lane
      // carries only the two constants, byte-identical across a conversation's
      // turns: anything varying per turn inside it would shift the provider's
      // cache breakpoint and re-write the whole prefix at the write premium
      // every turn instead of reading it. Everything volatile rides the turn's
      // USER message instead: the history seed below, and the per-turn context
      // inside the composed prompt.
      // ADR-050: the override text is a VERSIONED registry row when an operator
      // has pointed us at the system project that holds it, and the in-repo
      // constant otherwise. `resolveLangyPrompt` never throws — a miss, an
      // empty row or a read error all yield usable text — so the registry can
      // never keep a turn from starting. With no system project configured the
      // registry is skipped entirely and this is byte-identical to the constant,
      // which is what makes turning it on a no-op until a row is promoted.
      //
      // The one thing it must NOT do is swap the block mid-conversation over a
      // transient failure, which would rewrite the cache prefix above and
      // change the model's instructions between turns of one chat. A read error
      // therefore resolves to the process's last good registry text
      // (`source: "cached"`); only a genuine miss falls to the constant.
      //
      // This seam existed, seeded and documented, with NO caller: `pnpm
      // seed:langy-prompts` + promoting to `production` changed nothing at
      // runtime. It is wired here because that is where the system block is
      // composed (#5881).
      const override: ResolvedLangyTurnOverride =
        overrideResult.status === "fulfilled"
          ? overrideResult.value
          : { text: LANGY_OVERRIDE, source: "fallback" };
      if (overrideResult.status === "rejected") {
        logger.warn(
          { error: overrideResult.reason, conversationId: conversation.id },
          "langy system-block override resolution failed — using the in-repo constant",
        );
      }
      // Which path the system block took, on the turn's own span: the swap this
      // guards against is otherwise invisible except as a warn line in the
      // registry loader, and "turn 5 of this conversation ran on different
      // instructions" is exactly the question a trace should answer.
      trace
        .getActiveSpan()
        ?.setAttribute("langy.prompt.override.source", override.source);
      const system = [override.text, LANGY_REFERENT_POLICY].join("\n\n");

      // The history seed rides EVERY dispatch, not just the one after a probe
      // miss, because the worker serving the turn is disposable at any point
      // between here and the model call: recycled by a model switch, reaped on
      // idle, dead by the time the outbox or liveness re-dispatches this same
      // stashed payload to a fresh one. The manager holds the ground truth of
      // session freshness and folds the seed into the session's FIRST message
      // only; once in, it persists in the session's own transcript (and in the
      // provider's cached prefix) for every later turn.
      const historySeed = [conversationTranscript, conversationMemory]
        .filter((block): block is string => !!block && block.trim().length > 0)
        .join("\n\n");

      // The access the caller does not hold — named for the assistant so it
      // declines up front instead of running a refused command and retrying.
      // A failed resolve is not fatal: the turn runs without the note (the key
      // still refuses the action reactively), degraded, not broken.
      if (missingPermissionsResult.status === "rejected") {
        logger.warn(
          {
            error: missingPermissionsResult.reason,
            conversationId: conversation.id,
          },
          "failed to resolve caller's missing Langy permissions — the turn runs without the pre-flight note",
        );
      }
      const missingPermissionsNote =
        missingPermissionsResult.status === "fulfilled"
          ? renderLangyMissingPermissionsNote(missingPermissionsResult.value)
          : "";

      // The per-turn user-message lane: what the user is looking at and the
      // turn-scoped cap / access notes precede a clearly labelled ask, so the
      // model reads the DATA before the message that may refer to it.
      const prompt = composeLangyTurnPrompt({
        contextBlock: renderLangyTurnContext(turnContext),
        capNote: capReachedNote,
        permissionsNote: missingPermissionsNote,
        hasHistorySeed: historySeed.length > 0,
        userText,
      });

      if (handoffResult.status === "rejected") {
        logger.warn(
          { error: handoffResult.reason, conversationId: conversation.id },
          "failed to read pending langy handoff — cold-starting",
        );
      }
      const pendingHandoff =
        handoffResult.status === "fulfilled" ? handoffResult.value : null;

      // These Redis writes must precede the durable acceptance because its
      // process intent may dispatch immediately. They are independent, so only
      // one network-latency window enters the critical path.
      try {
        await Promise.all([
          accessStore.grant({
            projectId,
            conversationId: conversation.id,
            turnId,
            userId,
          }),
          handoffStore.stash({
            projectId,
            conversationId: conversation.id,
            turnId,
            actorUserId: userId,
            prompt,
            system,
            ...(historySeed ? { historySeed } : {}),
            modelOverride: turnModel,
            credentials,
            runToken,
            permitReserved: permit.reserved,
            ...(pendingHandoff ? { resumeToken: pendingHandoff.token } : {}),
          }),
        ]);
      } catch (error) {
        logger.error(
          { error, projectId, conversationId: conversation.id, turnId },
          "failed to prepare the langy turn",
        );
        throw new LangyAgentUnavailableError("Agent request failed");
      }

      try {
        await conversationService.acceptTurn({
          projectId,
          conversationId: conversation.id,
          turnId,
          questionParts,
          ...(conversation.isNew
            ? {
                conversationStart: {
                  userId,
                  title,
                  ...(mintedRunToken ? { runToken: mintedRunToken } : {}),
                },
              }
            : {}),
          ...(!isRetry && lastUserMessage?.role === "user"
            ? {
                userMessage: {
                  userId,
                  messageId: identity.messageId,
                  role: lastUserMessage.role,
                  parts: lastUserMessage.parts,
                  title,
                },
              }
            : {}),
          ...(pendingHandoff
            ? { consumeHandoffTurnId: pendingHandoff.turnId }
            : {}),
        });
      } catch (error) {
        logger.error(
          { error, projectId, conversationId: conversation.id, turnId },
          "failed to commit langy AcceptAgentTurn",
        );
        throw new LangyAgentUnavailableError("Agent request failed");
      }

      // Idempotency wins over the last few milliseconds: do not eagerly launch
      // the worker until the Postgres replay receipt is confirmed. If the commit
      // cannot be confirmed, the already-durable process outbox remains the sole
      // recovery path for this attempt.
      const admissionCommitted = await attempt.commit();
      if (admissionCommitted) {
        // Fast-path dispatch begins at the first safe instant. The process
        // outbox remains the at-least-once recovery path; Go's turnId claim
        // makes its later duplicate a benign no-op.
        void worker
          .dispatch({
            intent: pendingHandoff
              ? "revive"
              : credentials.langwatchApiKey
                ? "create"
                : "continue",
            projectId,
            userId,
            runToken,
            turnId,
            prompt,
            system,
            ...(historySeed ? { historySeed } : {}),
            conversationId: conversation.id,
            credentials,
            modelOverride: turnModel,
            ...(pendingHandoff ? { resumeToken: pendingHandoff.token } : {}),
          })
          .then((outcome) => {
            if (outcome !== "accepted") {
              logger.warn(
                { outcome, conversationId: conversation.id, turnId },
                "fast-path Langy dispatch was not accepted; outbox will retry",
              );
            }
          })
          .catch((error) => {
            logger.warn(
              { error, conversationId: conversation.id, turnId },
              "fast-path Langy dispatch failed; outbox will retry",
            );
          });
      }

      getLangyTurnsCounter("accepted").inc();
      return { conversationId: conversation.id, turnId };
    } catch (error) {
      getLangyTurnsCounter(
        error instanceof LangyTurnInProgressError
          ? "busy"
          : error instanceof LangyAgentUnavailableError
            ? "rejected"
            : "error",
      ).inc();
      await attempt.abort();
      if (error instanceof LangySessionKeyScopeError) {
        throw new LangyInsufficientScopeError(error.message);
      }
      throw error;
    }
  }
}
