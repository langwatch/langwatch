import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { LangyResourceContext, LangySkillContext } from "@langwatch/langy-contract";
import type { LangyStreamEntry } from "@langwatch/langy-contract";
import { trpcClient } from "../../../../behavior/langy-api";

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
 * A live signal routed out-of-band (not a message part): status/progress/ milestone/reasoning tick the status
 * line + thinking line; `plan` mirrors the manager's typed plan snapshot into the store, which the plan card
 * prefers over parsing the raw `todowrite` tool part.
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

/**
 * A custom AI-SDK `ChatTransport` for Langy.
 */
export function createLangyChatTransport(deps: LangyChatTransportDeps): ChatTransport<UIMessage> {
  return {
    async sendMessages(options) {
      const ctx = deps.getContext();
      // A create carries THIS send and nothing else.
      const lastUserMessage = options.messages.findLast((message) => message.role === "user");
      const turnInput = {
        // One logical send, one identity: minted fresh on every sendMessages
        // call (each composer submit / regenerate re-arms with a new key), so
        // a genuine re-send of the same text is a NEW turn. Transport/proxy
        // retries replay the same mutation body — same key, same content —
        // and collapse onto the same admitted turn.
        idempotencyKey: crypto.randomUUID(),
        messages: options.messages,
        ...(options.trigger ? { trigger: options.trigger } : {}),
        projectId: ctx.projectId,
        ...(ctx.modelOverride ? { modelOverride: ctx.modelOverride } : {}),
        ...(ctx.pageContext?.length ? { pageContext: ctx.pageContext } : {}),
        ...(ctx.skills?.length ? { skills: ctx.skills } : {}),
      };

      const { conversationId, turnId }: StartTurnResponse = ctx.conversationId
        ? await trpcClient.langy.continueConversation.mutate({
            ...turnInput,
            conversationId: ctx.conversationId,
          })
        : await trpcClient.langy.createConversation.mutate({
            ...turnInput,
            messages: lastUserMessage ? [lastUserMessage] : [],
            // Adopt the warmed conversation when the panel holds one, so the
            // first turn reuses the worker the panel open already booted.
            ...(ctx.pendingConversationId ? { conversationId: ctx.pendingConversationId } : {}),
          });
      deps.onIds({ conversationId, turnId });

      return subscribeTurnStream({
        projectId: ctx.projectId,
        conversationId,
        turnId,
        onSignal: deps.onSignal,
        ...(deps.onNavigate ? { onNavigate: deps.onNavigate } : {}),
        ...(deps.onUiAction ? { onUiAction: deps.onUiAction } : {}),
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
  onSettled?: (info: { reason: LangyTurnSettleReason }) => void;
  onWireEntry?: (entry: LangyStreamEntry, turnId: string) => void;
  abortSignal?: AbortSignal;
}): ReadableStream<UIMessageChunk> {
  let sub: Unsubscribable | undefined;

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      // The prose of a turn is not one block: it is the paragraphs written between the
      // calls.
      let openTextId: string | null = null;
      let closed = false;

      const openText = () => {
        if (openTextId) return openTextId;
        openTextId = crypto.randomUUID();
        controller.enqueue({ type: "text-start", id: openTextId });
        return openTextId;
      };
      const closeText = () => {
        if (!openTextId) return;
        controller.enqueue({ type: "text-end", id: openTextId });
        openTextId = null;
      };

      const finish = (reason: LangyTurnSettleReason) => {
        if (closed) return;
        closed = true;
        closeText();
        controller.enqueue({ type: "finish" });
        controller.close();
        sub?.unsubscribe();
        onSettled?.({ reason });
      };

      controller.enqueue({ type: "start" });

      // The manager emits a readiness status ("Starting Langy…") into the cold window
      // (worker tool prep produces no frames for many seconds).
      let sawOutput = false;
      const clearColdStartStatus = () => {
        if (sawOutput) return;
        sawOutput = true;
        onSignal({ type: "status", status: "" });
      };

      const onEntry = (entry: LangyStreamEntry) => {
        if (closed) return;
        // The tape sees it first, and sees ALL of it — including the entries the
        // switch below deliberately drops on the floor.
        onWireEntry?.(entry, turnId);
        switch (entry.type) {
          case "delta":
            clearColdStartStatus();
            controller.enqueue({
              type: "text-delta",
              id: openText(),
              delta: entry.text,
            });
            return;
          case "tool":
            clearColdStartStatus();
            // A starting call ends the paragraph before it, which is what puts
            // its card between that paragraph and the next. An ENDING call
            // updates the part it already opened, wherever that sits, so the
            // card stays where the work began and the text after it is not cut
            // in two by an output that lands late.
            if (entry.phase === "start") closeText();
            enqueueToolChunk(controller, entry);
            return;
          case "reasoning":
            clearColdStartStatus();
            onSignal(entry);
            return;
          case "plan":
            // A plan snapshot is real progress — retire the cold-start status —
            // and rides the store as the checklist the plan card prefers.
            clearColdStartStatus();
            onSignal(entry);
            return;
          case "status":
            onSignal({ ...entry, readiness: !sawOutput });
            return;
          case "progress":
          case "milestone":
            onSignal(entry);
            return;
          case "navigate":
            // Not a message part, not a signal the status line renders — a
            // one-shot action. Bare passthrough; the panel owns dedup + routing.
            onNavigate?.(entry);
            return;
          case "ui":
            // Same contract as navigate: a one-shot instruction for the page,
            // never a message part. The panel owns dedup, the claim, and the
            // handler execution.
            onUiAction?.(entry);
            return;
          case "error":
            controller.enqueue({ type: "error", errorText: entry.error });
            finish("error");
            return;
          case "end":
            finish("end");
            return;
        }
      };

      sub = trpcClient.langy.onTurnStream.subscribe(
        { projectId, conversationId, turnId },
        {
          onData: (entry: unknown) => onEntry(entry as LangyStreamEntry),
          onError: (err: unknown) => {
            if (closed) return;
            controller.enqueue({
              type: "error",
              errorText: err instanceof Error ? err.message : "Langy stream error",
            });
            finish("error");
          },
          onComplete: () => finish("closed"),
        },
      );

      abortSignal?.addEventListener("abort", () => {
        sub?.unsubscribe();
        if (!closed) {
          closed = true;
          controller.close();
        }
      });
    },
    cancel() {
      sub?.unsubscribe();
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
