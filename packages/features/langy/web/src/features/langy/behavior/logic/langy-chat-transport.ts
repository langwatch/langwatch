import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { LangyResourceContext, LangySkillContext } from "@langwatch/langy-contract";
import type { LangyStreamEntry } from "@langwatch/langy-contract";
import { trpcClient } from "../../../../behavior/langy-api.ts";

/**
 * What a tRPC subscription hands back.
 */
type Unsubscribable = { unsubscribe: () => void };

/**
 * The per-turn request inputs the transport owns.
 */
export interface LangyTurnRequestContext {
  projectId: string;
  conversationId: string | null;
  /**
   * The conversation id a panel-open warm minted ahead of the first message
   * (specs/langy/langy-worker-prewarm.feature).
   */
  pendingConversationId?: string | null;
  modelOverride?: string;
  pageContext?: LangyResourceContext[];
  skills?: LangySkillContext[];
}

/**
 * A live signal routed out-of-band (not a message part): status/progress/milestone/reasoning tick
 * the status/thinking lines; `plan` mirrors the manager's plan snapshot into the store.
 */
export type LangyTurnSignalEntry =
  | (Extract<LangyStreamEntry, { type: "status" }> & {
      /**
       * The status arrived BEFORE this stream produced any output — the manager's
       * readiness placeholder for silence ("Starting Langy…", "Thinking…").
       */
      readiness?: boolean;
    })
  | Extract<LangyStreamEntry, { type: "progress" | "milestone" | "reasoning" | "plan" }>;

/**
 * How a turn stream terminated. "end" is the genuine end-of-turn frame — the answer is
 * complete, so the caller may retire in-flight UI immediately.
 */
export type LangyTurnSettleReason = "end" | "error" | "closed";

export interface LangyChatTransportDeps {
  /** Read the current turn inputs at send time (owns projectId → fixes regenerate). */
  getContext: () => LangyTurnRequestContext;
  /** Adopt the conversation + turn the server started (replaces the header scrape). */
  onIds: (ids: { conversationId: string; turnId: string }) => void;
  /** Push a status/progress/milestone signal (drives StreamingStatusLine via the store). */
  onSignal: (signal: LangyTurnSignalEntry) => void;
  /**
   * Forward a live-only navigate instruction, bare passthrough — dedup (the
   * stream carries no entry id) and routing live in the panel, which alone
   * holds both the router and the active turn id the dedup key needs.
   */
  onNavigate?: (entry: Extract<LangyStreamEntry, { type: "navigate" }>) => void;
  /**
   * Forward a live-only UI action for the page to claim and execute, bare
   * passthrough like `onNavigate` — dedup, the claim race, and the handler
   * lookup all live in the panel's orchestration (`executeUiAction`).
   */
  onUiAction?: (entry: Extract<LangyStreamEntry, { type: "ui" }>) => void;
  /**
   * A card the developer has to answer while the turn runs (ADR-129), fast path for putting it
   * on screen before the durable `user_wait_started` tail arrives.
   */
  onLocalWait?: (
    entry: Extract<LangyStreamEntry, { type: "local_permission" | "question" }>,
  ) => void;
  /** The shared folder came or went while the turn ran. */
  onLocalWorkspace?: (entry: Extract<LangyStreamEntry, { type: "local_workspace" }>) => void;
  /** Fired when a turn stream terminates — the reconcile trigger. */
  onTurnSettled?: (info: { reason: LangyTurnSettleReason }) => void;
  /**
   * Every wire entry, unfiltered and before any interpretation — the tap the developer
   * drawer's tape records from.
   */
  onWireEntry?: (entry: LangyStreamEntry, turnId: string) => void;
}

/** The turn-start response the create/continue mutations return (ids, no stream). */
interface StartTurnResponse {
  conversationId: string;
  turnId: string;
}

/** Builds the shared mutation body — everything a create and a continue send alike. */
function buildTurnInput(
  ctx: LangyTurnRequestContext,
  options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
) {
  return {
    // One logical send, one identity: minted fresh on every sendMessages call
    // (each composer submit / regenerate re-arms with a new key), so a
    // genuine re-send of the same text is a NEW turn. Transport/proxy retries
    // replay the same mutation body — same key, same content — and collapse
    // onto the same admitted turn.
    idempotencyKey: crypto.randomUUID(),
    messages: options.messages,
    ...(options.trigger ? { trigger: options.trigger } : {}),
    projectId: ctx.projectId,
    ...(ctx.modelOverride ? { modelOverride: ctx.modelOverride } : {}),
    ...(ctx.pageContext?.length ? { pageContext: ctx.pageContext } : {}),
    ...(ctx.skills?.length ? { skills: ctx.skills } : {}),
  };
}

/** Starts (or continues) the turn on the server and returns its ids. */
async function startTurn(
  ctx: LangyTurnRequestContext,
  options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
): Promise<StartTurnResponse> {
  const turnInput = buildTurnInput(ctx, options);
  if (ctx.conversationId) {
    return trpcClient.langy.continueConversation.mutate({
      ...turnInput,
      conversationId: ctx.conversationId,
    });
  }
  // A create carries THIS send and nothing else.
  const lastUserMessage = options.messages.findLast((message) => message.role === "user");
  return trpcClient.langy.createConversation.mutate({
    ...turnInput,
    messages: lastUserMessage ? [lastUserMessage] : [],
    // Adopt the warmed conversation when the panel holds one, so the first
    // turn reuses the worker the panel open already booted.
    ...(ctx.pendingConversationId ? { conversationId: ctx.pendingConversationId } : {}),
  });
}

/**
 * A custom AI-SDK `ChatTransport` for Langy.
 */
export function createLangyChatTransport(deps: LangyChatTransportDeps): ChatTransport<UIMessage> {
  return {
    async sendMessages(options) {
      const ctx = deps.getContext();
      const { conversationId, turnId } = await startTurn(ctx, options);
      deps.onIds({ conversationId, turnId });

      return subscribeTurnStream({
        projectId: ctx.projectId,
        conversationId,
        turnId,
        onSignal: deps.onSignal,
        ...(deps.onNavigate ? { onNavigate: deps.onNavigate } : {}),
        ...(deps.onUiAction ? { onUiAction: deps.onUiAction } : {}),
        ...(deps.onLocalWait ? { onLocalWait: deps.onLocalWait } : {}),
        ...(deps.onLocalWorkspace ? { onLocalWorkspace: deps.onLocalWorkspace } : {}),
        onSettled: deps.onTurnSettled,
        ...(deps.onWireEntry ? { onWireEntry: deps.onWireEntry } : {}),
        abortSignal: options.abortSignal,
      });
    },

    // Resume is a re-subscribe + a fold-query reconcile, driven by the panel on
    // remount — not a transport-level reconnect. Returning null tells useChat
    // there is nothing to auto-reconnect to.
    async reconnectToStream() {
      return null;
    },
  };
}

/** Mutable per-stream bookkeeping, threaded through the entry handlers below. */
interface TurnStreamState {
  openTextId: string | null;
  closed: boolean;
  sawOutput: boolean;
}

function createTurnStreamState(): TurnStreamState {
  return { openTextId: null, closed: false, sawOutput: false };
}

/** A mutable box for the subscription — it exists only after `subscribe()` returns,
 *  but `finish` (built beforehand) needs to unsubscribe with it. */
type SubRef = { current?: Unsubscribable };

/** The prose of a turn is not one block: it is the paragraphs written between the calls. */
function openStreamText(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: TurnStreamState,
): string {
  if (state.openTextId) return state.openTextId;
  state.openTextId = crypto.randomUUID();
  controller.enqueue({ type: "text-start", id: state.openTextId });
  return state.openTextId;
}

function closeStreamText(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: TurnStreamState,
): void {
  if (!state.openTextId) return;
  controller.enqueue({ type: "text-end", id: state.openTextId });
  state.openTextId = null;
}

function finishTurnStream(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: TurnStreamState,
  subRef: SubRef,
  onSettled: ((info: { reason: LangyTurnSettleReason }) => void) | undefined,
  reason: LangyTurnSettleReason,
): void {
  if (state.closed) return;
  state.closed = true;
  closeStreamText(controller, state);
  controller.enqueue({ type: "finish" });
  controller.close();
  subRef.current?.unsubscribe();
  onSettled?.({ reason });
}

/** The manager emits a readiness status ("Starting Langy…") into the cold window
 *  (worker tool prep produces no frames for many seconds); the first real signal
 *  of any kind retires it. */
function clearColdStartStatus(
  state: TurnStreamState,
  onSignal: (signal: LangyTurnSignalEntry) => void,
): void {
  if (state.sawOutput) return;
  state.sawOutput = true;
  onSignal({ type: "status", status: "" });
}

interface EntryHandlerDeps {
  controller: ReadableStreamDefaultController<UIMessageChunk>;
  state: TurnStreamState;
  subRef: SubRef;
  onSignal: (signal: LangyTurnSignalEntry) => void;
  onNavigate?: (entry: Extract<LangyStreamEntry, { type: "navigate" }>) => void;
  onUiAction?: (entry: Extract<LangyStreamEntry, { type: "ui" }>) => void;
  onLocalWait?: (
    entry: Extract<LangyStreamEntry, { type: "local_permission" | "question" }>,
  ) => void;
  onLocalWorkspace?: (entry: Extract<LangyStreamEntry, { type: "local_workspace" }>) => void;
  onSettled?: (info: { reason: LangyTurnSettleReason }) => void;
}

type EntryHandler<T extends LangyStreamEntry["type"]> = (
  entry: Extract<LangyStreamEntry, { type: T }>,
  deps: EntryHandlerDeps,
) => void;

function handleDelta(
  entry: Extract<LangyStreamEntry, { type: "delta" }>,
  deps: EntryHandlerDeps,
): void {
  clearColdStartStatus(deps.state, deps.onSignal);
  deps.controller.enqueue({
    type: "text-delta",
    id: openStreamText(deps.controller, deps.state),
    delta: entry.text,
  });
}

function handleTool(
  entry: Extract<LangyStreamEntry, { type: "tool" }>,
  deps: EntryHandlerDeps,
): void {
  clearColdStartStatus(deps.state, deps.onSignal);
  // A starting call ends the paragraph before it, which is what puts its card
  // between that paragraph and the next. An ENDING call updates the part it
  // already opened, wherever that sits, so the card stays where the work
  // began and the text after it is not cut in two by an output that lands late.
  if (entry.phase === "start") closeStreamText(deps.controller, deps.state);
  enqueueToolChunk(deps.controller, entry);
}

/** Shared by "reasoning" and "plan": both are real progress, so both retire the
 *  cold-start status, and both just ride straight onto the signal channel. */
function handleProgressSignal(
  entry: Extract<LangyStreamEntry, { type: "reasoning" | "plan" }>,
  deps: EntryHandlerDeps,
): void {
  clearColdStartStatus(deps.state, deps.onSignal);
  deps.onSignal(entry);
}

function handleStatus(
  entry: Extract<LangyStreamEntry, { type: "status" }>,
  deps: EntryHandlerDeps,
): void {
  deps.onSignal({ ...entry, readiness: !deps.state.sawOutput });
}

function handlePassthroughSignal(
  entry: Extract<LangyStreamEntry, { type: "progress" | "milestone" }>,
  deps: EntryHandlerDeps,
): void {
  deps.onSignal(entry);
}

function handleNavigate(
  entry: Extract<LangyStreamEntry, { type: "navigate" }>,
  deps: EntryHandlerDeps,
): void {
  // Not a message part, not a signal the status line renders — a one-shot
  // action. Bare passthrough; the panel owns dedup + routing.
  deps.onNavigate?.(entry);
}

function handleUiAction(
  entry: Extract<LangyStreamEntry, { type: "ui" }>,
  deps: EntryHandlerDeps,
): void {
  // Same contract as navigate: a one-shot instruction for the page, never a
  // message part. The panel owns dedup, the claim, and the handler execution.
  deps.onUiAction?.(entry);
}

function handleLocalWait(
  entry: Extract<LangyStreamEntry, { type: "local_permission" | "question" }>,
  deps: EntryHandlerDeps,
): void {
  // A card the turn is waiting on. It never retires the cold-start status,
  // because a turn that is waiting for a person has produced no output yet
  // and the status line still reads correctly.
  deps.onLocalWait?.(entry);
}

function handleLocalWorkspace(
  entry: Extract<LangyStreamEntry, { type: "local_workspace" }>,
  deps: EntryHandlerDeps,
): void {
  deps.onLocalWorkspace?.(entry);
}

function handleStreamError(
  entry: Extract<LangyStreamEntry, { type: "error" }>,
  deps: EntryHandlerDeps,
): void {
  deps.controller.enqueue({ type: "error", errorText: entry.error });
  finishTurnStream(deps.controller, deps.state, deps.subRef, deps.onSettled, "error");
}

function handleEnd(
  _entry: Extract<LangyStreamEntry, { type: "end" }>,
  deps: EntryHandlerDeps,
): void {
  finishTurnStream(deps.controller, deps.state, deps.subRef, deps.onSettled, "end");
}

/**
 * One handler per wire entry type — a lookup table instead of a branch, so
 * dispatching an entry costs nothing structurally in the caller.
 */
const ENTRY_HANDLERS: { [T in LangyStreamEntry["type"]]: EntryHandler<T> } = {
  delta: handleDelta,
  tool: handleTool,
  reasoning: handleProgressSignal,
  plan: handleProgressSignal,
  status: handleStatus,
  progress: handlePassthroughSignal,
  milestone: handlePassthroughSignal,
  navigate: handleNavigate,
  ui: handleUiAction,
  local_permission: handleLocalWait,
  question: handleLocalWait,
  local_workspace: handleLocalWorkspace,
  error: handleStreamError,
  end: handleEnd,
};

function dispatchStreamEntry(entry: LangyStreamEntry, deps: EntryHandlerDeps): void {
  const handler = ENTRY_HANDLERS[entry.type] as EntryHandler<typeof entry.type>;
  handler(entry, deps);
}

/**
 * Bridge one turn's `onTurnStream` subscription into a UIMessageChunk stream.
 * The mapping mirrors the deleted `attachTurnStream` exactly.
 */
function subscribeTurnStream({
  projectId,
  conversationId,
  turnId,
  onSignal,
  onNavigate,
  onUiAction,
  onLocalWait,
  onLocalWorkspace,
  onSettled,
  onWireEntry,
  abortSignal,
}: {
  projectId: string;
  conversationId: string;
  turnId: string;
  onSignal: (signal: LangyTurnSignalEntry) => void;
  onNavigate?: (entry: Extract<LangyStreamEntry, { type: "navigate" }>) => void;
  onUiAction?: (entry: Extract<LangyStreamEntry, { type: "ui" }>) => void;
  onLocalWait?: (
    entry: Extract<LangyStreamEntry, { type: "local_permission" | "question" }>,
  ) => void;
  onLocalWorkspace?: (entry: Extract<LangyStreamEntry, { type: "local_workspace" }>) => void;
  onSettled?: (info: { reason: LangyTurnSettleReason }) => void;
  onWireEntry?: (entry: LangyStreamEntry, turnId: string) => void;
  abortSignal?: AbortSignal;
}): ReadableStream<UIMessageChunk> {
  const subRef: SubRef = {};

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      const state = createTurnStreamState();
      const deps: EntryHandlerDeps = {
        controller,
        state,
        subRef,
        onSignal,
        onNavigate,
        onUiAction,
        onLocalWait,
        onLocalWorkspace,
        onSettled,
      };

      controller.enqueue({ type: "start" });

      const onEntry = (entry: LangyStreamEntry) => {
        if (state.closed) return;
        // The tape sees it first, and sees ALL of it — including the entries
        // a handler deliberately drops on the floor.
        onWireEntry?.(entry, turnId);
        dispatchStreamEntry(entry, deps);
      };

      subRef.current = trpcClient.langy.onTurnStream.subscribe(
        { projectId, conversationId, turnId },
        {
          onData: (entry: unknown) => onEntry(entry as LangyStreamEntry),
          onError: (err: unknown) => {
            if (state.closed) return;
            controller.enqueue({
              type: "error",
              errorText: err instanceof Error ? err.message : "Langy stream error",
            });
            finishTurnStream(controller, state, subRef, onSettled, "error");
          },
          onComplete: () => finishTurnStream(controller, state, subRef, onSettled, "closed"),
        },
      );

      abortSignal?.addEventListener("abort", () => {
        subRef.current?.unsubscribe();
        if (!state.closed) {
          state.closed = true;
          controller.close();
        }
      });
    },
    cancel() {
      subRef.current?.unsubscribe();
    },
  });
}

/** Map a live tool entry onto the AI-SDK tool chunks the renderers consume. */
function enqueueToolChunk(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  entry: Extract<LangyStreamEntry, { type: "tool" }>,
) {
  if (entry.phase === "start") {
    controller.enqueue({
      type: "tool-input-available",
      toolCallId: entry.id,
      toolName: entry.name,
      input: entry.input ?? {},
    });
    return;
  }
  if (entry.isError) {
    controller.enqueue({
      type: "tool-output-error",
      toolCallId: entry.id,
      errorText: entry.output ?? "Tool call failed",
    });
    return;
  }
  controller.enqueue({
    type: "tool-output-available",
    toolCallId: entry.id,
    output: entry.output ?? "",
  });
}
