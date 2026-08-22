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
import type {
  LangyCredentialService,
  LangyCredentials,
} from "~/server/app-layer/langy/LangyCredentialService";
import { stripGithubCredentials } from "~/server/app-layer/langy/LangyCredentialService";
import { LangySessionKeyScopeError } from "~/server/app-layer/langy/langyApiKey";
import {
  extractLangyConversationMemory,
  LANGY_REFERENT_POLICY,
  renderLangyConversationMemory,
  renderLangyConversationTranscript,
} from "~/server/app-layer/langy/langyConversationMemory";
import type { LangyHarness } from "~/server/app-layer/langy/langyHarness";
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
 * Compose the turn's user-message prompt.
 *
 * A bare ask stays a bare ask: when nothing is prepended, the prompt is
 * exactly the user's text, as it always was — and that is the COMMON turn,
 * so the label must never ride a message that carries no data ahead of the
 * ask (it used to appear on every follow-up merely because a history seed
 * EXISTED, though the manager folds a seed into a fresh session's first
 * message only). The moment the screen-context block or the cap note rides
 * ahead of the ask, it is set apart under {@link LANGY_USER_MESSAGE_LABEL}
 * so no prepended DATA can blur into the user's own words. The history seed
 * carries its own trailing label for the same reason (see the seed assembly
 * in `startConversationTurn`), placed there so the label exists exactly when
 * the fold does.
 *
 * Volatile content lives HERE, in the message, and never in the system
 * parameter: the system lane must stay byte-identical across a conversation's
 * turns for provider prompt caching to read the prefix instead of re-writing
 * it (see the composition site in `startConversationTurn`).
 */
export function composeLangyTurnPrompt({
  contextBlock,
  capNote,
  userText,
}: {
  contextBlock: string | null;
  capNote: string;
  userText: string;
}): { prompt: string; labelled: boolean } {
  const preamble = [contextBlock, capNote]
    .map((block) => (block ?? "").trim())
    .filter((block) => block.length > 0);
  if (preamble.length === 0) return { prompt: userText, labelled: false };
  return {
    prompt: [...preamble, `${LANGY_USER_MESSAGE_LABEL}\n${userText}`].join(
      "\n\n",
    ),
    labelled: true,
  };
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
  /**
   * Adopt `requestedConversationId` as a NEW conversation when it does not
   * exist yet, instead of minting a fresh id. Opt-in continuity for callers
   * that key on an externally-chosen id (scenario runs); an id that cannot be
   * adopted fails the turn loudly rather than falling back to a mint.
   */
  adoptConversationId?: boolean;
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
   * is the best-effort worker abort behind a user Stop (ADR-078); `warm` is
   * the fire-and-forget panel-open pre-boot
   * (specs/langy/langy-worker-prewarm.feature). */
  worker: Pick<
    LangyWorkerPort,
    "probe" | "dispatch" | "cancel" | "warm"
  > | null;
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
  /**
   * Check-only view of the per-day PR cap, no permit is reserved. The warm
   * path uses it for signature parity with the turn (which strips the GitHub
   * token when the cap is reached) without spending PR budget on a panel
   * open. Optional: absent means the warm assumes the cap is not reached.
   */
  checkPermit?: (args: { userId: string }) => Promise<{ allowed: boolean }>;
  /**
   * Which worker harness serves this turn (`release_langy_pi_harness`),
   * resolved once per turn in the base-dependency phase. Contract:
   * never throws (see `resolveLangyHarness`). Optional: absent (tests,
   * minimal compositions) leaves `credentials.harness` unset, which the
   * manager treats as its default harness.
   */
  resolveHarness?: (args: {
    userId: string;
    projectId: string;
    organizationId: string;
  }) => Promise<LangyHarness>;
  perDayPrCap: number;
  /** Mint the per-turn session key (prisma pre-bound at composition). */
  mintSessionKey: (args: {
    session: Session;
    projectId: string;
    organizationId: string;
  }) => Promise<{ token: string; apiKeyId: string }>;
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
 * The probe payload for the worker this credential bundle + model would spawn.
 * ONE definition, shared by the turn path and the panel-open warm
 * (specs/langy/langy-worker-prewarm.feature): the manager canonicalises these
 * capability fields into the worker signature, so any drift between the two
 * callers would make every warm boot a worker the turn cannot reuse. The model
 * is part of the signature (a model change is a probe MISS and the worker
 * re-provisions), as are the GitHub scope, the egress list, the ADR-061 mirror
 * tier and the harness.
 */
function buildWorkerProbeArgs({
  projectId,
  actorUserId,
  conversationId,
  model,
  credentials,
}: {
  projectId: string;
  actorUserId: string;
  conversationId: string;
  model: string;
  credentials: LangyCredentials;
}): Parameters<LangyWorkerPort["probe"]>[0] {
  return {
    projectId,
    actorUserId,
    conversationId,
    model,
    hasGithubAuth: !!credentials.githubToken,
    ...(credentials.githubRepoScopeKey
      ? { githubRepoScopeKey: credentials.githubRepoScopeKey }
      : {}),
    ...(credentials.egressAllowlist
      ? { egressAllowlist: credentials.egressAllowlist }
      : {}),
    ...(credentials.mirrorTier ? { mirrorTier: credentials.mirrorTier } : {}),
    ...(credentials.harness ? { harness: credentials.harness } : {}),
  };
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
   * Pre-boot the conversation's worker on panel open, BEFORE the first message
   * (specs/langy/langy-worker-prewarm.feature). Resolves the SAME credential
   * surface a turn would, the worker signature is made of exactly those parts,
   * so any divergence boots a worker the first turn cannot reuse, then probes,
   * mints a session key only on a probe miss (a warm IS a spawn, and the
   * manager refuses a keyless spawn), and fires the manager's warm without
   * waiting on the boot.
   *
   * Returns the conversation id (server-minted when none was given) so the
   * first message can adopt the warmed conversation, plus whether a worker is
   * warm or warming. NEVER throws: a warm is an optimisation, every failure
   * degrades to the cold start the user would have had anyway, and the first
   * real message is where errors get their proper surfacing, a warm error
   * card would only front-run it.
   *
   * Key lifecycle on this path, spelled out because there is no turn attempt
   * holding a rollback: the minted key's id rides the credentials so the
   * manager can revoke it on worker death (idle reap included), and the
   * key's own expiry is the backstop for a warm that never reaches the
   * manager (the warm port is fire-and-forget and swallows transport
   * failures), see specs/langy/langy-session-key-lifecycle.feature.
   */
  async warmConversationWorker(args: {
    projectId: string;
    session: Session;
    /**
     * Warm an EXISTING conversation's worker, or null to mint the id the first
     * message will adopt. An unknown id is ADOPTED (same semantics the first
     * message applies via `ensureConversation(adoptUnknownId)`), so warm and
     * turn agree on the aggregate key; an unadoptable id warms nothing.
     */
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    // Written by resolveAndWarm as soon as the id exists, so a later failure
    // still hands the caller the id the first message could adopt.
    const progress: { conversationId: string | null } = {
      conversationId: null,
    };
    try {
      return await this.resolveAndWarm({ ...args, progress });
    } catch (error) {
      const { projectId } = args;
      const conversationId = progress.conversationId;
      if (error instanceof LangySessionKeyScopeError) {
        // A user whose role carries no Langy scope gets the proper refusal on
        // the first real message; the warm stays silent on purpose.
        logger.debug(
          { error, projectId, conversationId },
          "langy warm skipped, session key scope refusal, first message will surface it",
        );
      } else {
        logger.warn(
          { error, projectId, conversationId },
          "langy warm failed, the first message cold-starts the worker",
        );
      }
      return { conversationId, warmed: false };
    }
  }

  /**
   * The warm happy path, throws freely; `warmConversationWorker` is the one
   * catch that turns every failure into a silent cold start.
   */
  private async resolveAndWarm({
    projectId,
    session,
    requestedConversationId,
    modelOverride,
    progress,
  }: {
    projectId: string;
    session: Session;
    requestedConversationId: string | null;
    modelOverride?: string;
    /**
     * Written as soon as the conversation id exists, so a later failure still
     * hands the caller the id the first message could adopt.
     */
    progress: { conversationId: string | null };
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    const { worker } = this.deps;
    const userId = session.user.id;
    const { speculativeConversation, credentials, resolvedModel } =
      await resolveLangyTurnBaseDependencies({
        deps: this.deps,
        projectId,
        userId,
        session,
        requestedConversationId,
        ...(requestedConversationId ? { adoptConversationId: true } : {}),
        ...(modelOverride ? { modelOverride } : {}),
      });
    const conversationId = speculativeConversation.id;
    progress.conversationId = conversationId;

    const warmModel = modelOverride ?? resolvedModel;
    if (!worker || !warmModel) {
      return { conversationId, warmed: false };
    }

    // Allowlist parity with the turn: warming on a model the turn would
    // reject boots a worker the turn can never reuse.
    const modelsAllowed = await this.deps.credentials.getModelsAllowed({
      projectId,
      organizationId: credentials.organizationId,
    });
    if (modelsAllowed && !modelsAllowed.includes(warmModel)) {
      return { conversationId, warmed: false };
    }

    await this.applyWarmPrCapParity({ credentials, userId });

    const alive = await worker.probe(
      buildWorkerProbeArgs({
        projectId,
        actorUserId: userId,
        conversationId,
        model: warmModel,
        credentials,
      }),
    );
    if (alive) {
      // Already warm. The probe is what keeps this path inside the
      // key-lifecycle rule: never mint a key a running worker would discard.
      return { conversationId, warmed: true };
    }

    const minted = await this.deps.mintSessionKey({
      session,
      projectId,
      organizationId: credentials.organizationId,
    });
    credentials.langwatchApiKey = minted.token;
    credentials.langwatchApiKeyId = minted.apiKeyId;

    // Fire-and-forget: the panel is not waiting on the boot, only on the id
    // above. Nothing awaits this promise, so the outer catch cannot see a
    // rejection: it would leave the process on Node's unhandled-rejection
    // path, on the one code path whose entire contract is that a warm failure
    // is a cold start. The dispatch call in this same file catches for the
    // same reason.
    void worker
      .warm({
        projectId,
        actorUserId: userId,
        conversationId,
        credentials,
        modelOverride: warmModel,
      })
      .catch((error: unknown) => {
        logger.warn(
          { error, projectId, conversationId },
          "langy warm dispatch failed, the first message cold-starts the worker",
        );
      });
    return { conversationId, warmed: true };
  }

  /**
   * GitHub PR-cap parity for the warm, WITHOUT reserving: the turn strips the
   * token when the cap is reached, so the warm must produce the same worker
   * signature, but a panel open must never spend a PR permit, so it only
   * peeks through the check-only `checkPermit` view.
   */
  private async applyWarmPrCapParity({
    credentials,
    userId,
  }: {
    credentials: LangyCredentials;
    userId: string;
  }): Promise<void> {
    if (!credentials.githubToken || !this.deps.checkPermit) return;
    const { allowed } = await this.deps.checkPermit({ userId });
    if (!allowed) {
      stripGithubCredentials(credentials);
    }
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
      adoptConversationId,
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
        ...(adoptConversationId ? { adoptConversationId } : {}),
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
      // The FIRST USER message names the conversation, never messages[0]
      // verbatim: a client can send assistant parts it still held (a new chat
      // started while the previous reply streamed), and those must not become
      // the title.
      const title =
        extractTextFromParts(
          messages.find((message) => message.role === "user")?.parts,
        ).slice(0, 80) || null;

      // The per-conversation frame-signing key is created from resolved
      // conversation state, never from a caller-supplied "new" flag.
      const mintedRunToken = conversation.isNew ? mintRunToken() : null;

      const probeWorker = () =>
        worker.probe(
          buildWorkerProbeArgs({
            projectId,
            actorUserId: userId,
            conversationId: conversation.id,
            model: turnModel,
            credentials,
          }),
        );

      // With no GitHub capability, the signature is already final; overlap the
      // cheap probe with the conversation-scoped reads.
      const earlyWorkerProbe = credentials.githubToken ? null : probeWorker();

      const [
        currentResult,
        handoffResult,
        runTokenResult,
        modelsAllowedResult,
        memoryResult,
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
        stripGithubCredentials(credentials);
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
      const seedBlocks = [conversationTranscript, conversationMemory].filter(
        (block): block is string => !!block && block.trim().length > 0,
      );

      // The per-turn user-message lane: what the user is looking at and the
      // turn-scoped cap note precede a clearly labelled ask, so the model
      // reads the DATA before the message that may refer to it.
      const { prompt, labelled } = composeLangyTurnPrompt({
        contextBlock: renderLangyTurnContext(turnContext),
        capNote: capReachedNote,
        userText,
      });
      // The seed ends with the ask's label when the prompt itself carries
      // none: the manager folds `seed + prompt` into a fresh session's first
      // message, and the label must sit between the transcript and the user's
      // words there — while a resumed session, the common case, gets the bare
      // ask with no label at all.
      const historySeed =
        seedBlocks.length > 0
          ? [
              ...seedBlocks,
              ...(labelled ? [] : [LANGY_USER_MESSAGE_LABEL]),
            ].join("\n\n")
          : "";

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
        logger.warn(
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
          model: turnModel,
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
        logger.warn(
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
