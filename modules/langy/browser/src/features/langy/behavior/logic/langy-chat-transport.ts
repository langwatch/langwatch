import { generate } from "@langwatch/ksuid";
import type { LangyResourceContext, LangySkillContext } from "@langwatch/langy-contract";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import type { LangyStreamWireEntry, LangyTrpcClient } from "../../../../behavior/langy-api.ts";

/**
 * What a tRPC subscription hands back.
 */
type Unsubscribable = { unsubscribe: () => void };

/** The three procedures a turn runs on, off the api provider's own client. */
export type LangyTurnClient = {
  langy: Pick<
    LangyTrpcClient["langy"],
    "createConversation" | "continueConversation" | "onTurnStream"
  >;
};

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
  | (Extract<LangyStreamWireEntry, { type: "status" }> & {
      /**
       * The status arrived BEFORE this stream produced any output — the manager's
       * readiness placeholder for silence ("Starting Langy…", "Thinking…").
       */
      readiness?: boolean;
    })
  | Extract<LangyStreamWireEntry, { type: "progress" | "milestone" | "reasoning" | "plan" }>;

/**
 * How a turn stream terminated. "end" is the genuine end-of-turn frame — the answer is
 * complete, so the caller may retire in-flight UI immediately.
 */
export type LangyTurnSettleReason = "end" | "error" | "closed";

export interface LangyChatTransportDeps {
  /** The client the turn's mutations and stream subscription go through. */
  client: LangyTurnClient;
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
  onNavigate?: (entry: Extract<LangyStreamWireEntry, { type: "navigate" }>) => void;
  /**
   * Forward a live-only UI action for the page to claim and execute, bare
   * passthrough like `onNavigate` — dedup, the claim race, and the handler
   * lookup all live in the panel's orchestration (`executeUiAction`).
   */
  onUiAction?: (entry: Extract<LangyStreamWireEntry, { type: "ui" }>) => void;
  /**
   * A card the developer has to answer while the turn runs (ADR-129), fast path for putting it
   * on screen before the durable `user_wait_started` tail arrives.
   */
  onLocalWait?: (
    entry: Extract<LangyStreamWireEntry, { type: "local_permission" | "question" }>,
  ) => void;
  /** The shared folder came or went while the turn ran. */
  onLocalWorkspace?: (entry: Extract<LangyStreamWireEntry, { type: "local_workspace" }>) => void;
  /** Fired when a turn stream terminates — the reconcile trigger. */
  onTurnSettled?: (info: { reason: LangyTurnSettleReason }) => void;
  /**
   * The turn a resume reattaches to: one the durable record named and this tab adopted without
   * dispatching it (a server-started turn, another tab's send, a refresh mid-turn). Null means
   * nothing to reattach to. Read at resume time, never captured, like `getContext`.
   */
  getResumeTarget?: () => { projectId: string; conversationId: string; turnId: string } | null;
  /**
   * Every wire entry, unfiltered and before any interpretation — the tap the developer
   * drawer's tape records from.
   */
  onWireEntry?: (entry: LangyStreamWireEntry, turnId: string) => void;
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
  const regenerations = new Map<string, number>();
  return {
    async sendMessages(options) {
      const ctx = deps.getContext();
      const idempotencyKey = turnIdempotencyKey({ options, regenerations });
      const { conversationId, turnId } = await startTurn({
        client: deps.client,
        ctx,
        options,
        idempotencyKey,
      });
      deps.onIds({ conversationId, turnId });

      return subscribeTurnStream({
        client: deps.client,
        projectId: ctx.projectId,
        conversationId,
        turnId,
        ...streamCallbacks(deps),
        abortSignal: options.abortSignal,
      });
    },

    // A turn this tab did not dispatch has no stream here until something subscribes to it: the
    // live-only entries (navigate, ui, the text as it is written) reach a tab only through
    // `onTurnStream`, which replays the buffered prefix first, so a resume sees the whole turn.
    async reconnectToStream() {
      const target = deps.getResumeTarget?.();
      if (!target) return null;
      return subscribeTurnStream({ client: deps.client, ...target, ...streamCallbacks(deps) });
    },
  };
}

type SendOptions = Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];

/**
 * One key per user intent: the sent message's id and the trigger, plus a count of regenerates of
 * that message. A retry of the same send repeats its key and dedupes; a re-send (a new message) or
 * another regenerate is a new turn.
 */
function turnIdempotencyKey({
  options,
  regenerations,
}: {
  options: SendOptions;
  regenerations: Map<string, number>;
}): string {
  const lastUserMessage = options.messages.findLast((message) => message.role === "user");
  const sentId = lastUserMessage?.id ?? options.chatId;
  if (options.trigger !== "regenerate-message") return `${sentId}:${options.trigger}`;
  const count = (regenerations.get(sentId) ?? 0) + 1;
  regenerations.set(sentId, count);
  return `${sentId}:${options.trigger}:${count}`;
}

/** Admits the turn: continues the open conversation, or creates one carrying only this send. */
async function startTurn({
  client,
  ctx,
  options,
  idempotencyKey,
}: {
  client: LangyTurnClient;
  ctx: LangyTurnRequestContext;
  options: SendOptions;
  idempotencyKey: string;
}): Promise<StartTurnResponse> {
  // A create carries THIS send and nothing else.
  const lastUserMessage = options.messages.findLast((message) => message.role === "user");
  const turnInput = {
    idempotencyKey,
    messages: options.messages,
    ...(options.trigger ? { trigger: options.trigger } : {}),
    projectId: ctx.projectId,
    ...(ctx.modelOverride ? { modelOverride: ctx.modelOverride } : {}),
    ...(ctx.pageContext?.length ? { pageContext: ctx.pageContext } : {}),
    ...(ctx.skills?.length ? { skills: ctx.skills } : {}),
  };

  if (ctx.conversationId) {
    return client.langy.continueConversation.mutate({
      ...turnInput,
      conversationId: ctx.conversationId,
    });
  }
  return client.langy.createConversation.mutate({
    ...turnInput,
    messages: lastUserMessage ? [lastUserMessage] : [],
    // Adopt the warmed conversation when the panel holds one, so the
    // first turn reuses the worker the panel open already booted.
    ...(ctx.pendingConversationId ? { conversationId: ctx.pendingConversationId } : {}),
  });
}

/** The entry handlers both a dispatched and a resumed stream route through. */
function streamCallbacks(deps: LangyChatTransportDeps) {
  return {
    onSignal: deps.onSignal,
    ...(deps.onNavigate ? { onNavigate: deps.onNavigate } : {}),
    ...(deps.onUiAction ? { onUiAction: deps.onUiAction } : {}),
    ...(deps.onLocalWait ? { onLocalWait: deps.onLocalWait } : {}),
    ...(deps.onLocalWorkspace ? { onLocalWorkspace: deps.onLocalWorkspace } : {}),
    onSettled: deps.onTurnSettled,
    ...(deps.onWireEntry ? { onWireEntry: deps.onWireEntry } : {}),
  };
}

type Controller = ReadableStreamDefaultController<UIMessageChunk>;

/** Where a turn stream's entries go besides the message chunks. */
type TurnStreamHandlers = {
  onSignal: (signal: LangyTurnSignalEntry) => void;
  onNavigate?: (entry: Extract<LangyStreamWireEntry, { type: "navigate" }>) => void;
  onUiAction?: (entry: Extract<LangyStreamWireEntry, { type: "ui" }>) => void;
  onLocalWait?: (
    entry: Extract<LangyStreamWireEntry, { type: "local_permission" | "question" }>,
  ) => void;
  onLocalWorkspace?: (entry: Extract<LangyStreamWireEntry, { type: "local_workspace" }>) => void;
  onSettled?: (info: { reason: LangyTurnSettleReason }) => void;
  onWireEntry?: (entry: LangyStreamWireEntry, turnId: string) => void;
};

/**
 * One turn's chunk stream while it is open. The prose of a turn is the paragraphs written between
 * the calls, so a text run opens on the first delta and closes when a call starts; the readiness
 * status covers the cold window until the first real output retires it.
 */
class TurnStreamSink {
  private openTextId: string | null = null;
  private sawOutput = false;
  private sawReadinessStatus = false;
  closed = false;

  constructor(
    private readonly controller: Controller,
    private readonly handlers: TurnStreamHandlers,
    private readonly unsubscribe: () => void,
  ) {}

  text(delta: string): void {
    this.clearColdStartStatus();
    if (!this.openTextId) {
      this.openTextId = generate("langytext").toString();
      this.controller.enqueue({ type: "text-start", id: this.openTextId });
    }
    this.controller.enqueue({ type: "text-delta", id: this.openTextId, delta });
  }

  closeText(): void {
    if (!this.openTextId) return;
    this.controller.enqueue({ type: "text-end", id: this.openTextId });
    this.openTextId = null;
  }

  /** A starting call ends the paragraph before it; an ending one updates the part it opened. */
  tool(entry: Extract<LangyStreamWireEntry, { type: "tool" }>): void {
    this.clearColdStartStatus();
    if (entry.phase === "start") this.closeText();
    enqueueToolChunk(this.controller, entry);
  }

  /** Real progress (reasoning, a plan snapshot) retires the cold-start status. */
  progress(signal: LangyTurnSignalEntry): void {
    this.clearColdStartStatus();
    this.handlers.onSignal(signal);
  }

  /** Only the first status before output is the placeholder; a later one (a retry line) is real. */
  status(entry: Extract<LangyStreamWireEntry, { type: "status" }>): void {
    const readiness = !this.sawOutput && !this.sawReadinessStatus;
    this.sawReadinessStatus = true;
    this.handlers.onSignal({ ...entry, readiness });
  }

  error(errorText: string): void {
    this.controller.enqueue({ type: "error", errorText });
    this.finish("error");
  }

  finish(reason: LangyTurnSettleReason): void {
    if (this.closed) return;
    this.closed = true;
    this.closeText();
    this.controller.enqueue({ type: "finish" });
    this.controller.close();
    this.unsubscribe();
    this.handlers.onSettled?.({ reason });
  }

  abort(): void {
    this.unsubscribe();
    if (this.closed) return;
    this.closed = true;
    this.controller.close();
  }

  private clearColdStartStatus(): void {
    if (this.sawOutput) return;
    this.sawOutput = true;
    this.handlers.onSignal({ type: "status", status: "" });
  }
}

/**
 * Where one entry goes. Navigate and ui are one-shot instructions for the page, never message
 * parts; a card the turn waits on never retires the cold-start status, since a turn waiting for a
 * person has produced no output yet.
 */
function routeStreamEntry({
  entry,
  sink,
  handlers,
}: {
  entry: LangyStreamWireEntry;
  sink: TurnStreamSink;
  handlers: TurnStreamHandlers;
}): void {
  switch (entry.type) {
    case "delta":
      return sink.text(entry.text);
    case "tool":
      return sink.tool(entry);
    case "reasoning":
    case "plan":
      return sink.progress(entry);
    case "status":
      return sink.status(entry);
    case "progress":
    case "milestone":
      return handlers.onSignal(entry);
    case "navigate":
      return handlers.onNavigate?.(entry);
    case "ui":
      return handlers.onUiAction?.(entry);
    case "local_permission":
    case "question":
      return handlers.onLocalWait?.(entry);
    case "local_workspace":
      return handlers.onLocalWorkspace?.(entry);
    case "error":
      return sink.error(entry.error);
    case "end":
      return sink.finish("end");
  }
}

/**
 * Bridge one turn's `onTurnStream` subscription into a UIMessageChunk stream. The tape
 * (`onWireEntry`) sees every entry first, including the ones the routing drops.
 */
function subscribeTurnStream({
  client,
  projectId,
  conversationId,
  turnId,
  abortSignal,
  ...handlers
}: TurnStreamHandlers & {
  client: LangyTurnClient;
  projectId: string;
  conversationId: string;
  turnId: string;
  abortSignal?: AbortSignal;
}): ReadableStream<UIMessageChunk> {
  let sub: Unsubscribable | undefined;

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      const sink = new TurnStreamSink(controller, handlers, () => sub?.unsubscribe());
      controller.enqueue({ type: "start" });
      sub = client.langy.onTurnStream.subscribe(
        { projectId, conversationId, turnId },
        {
          onData: (entry) => {
            if (sink.closed) return;
            handlers.onWireEntry?.(entry, turnId);
            routeStreamEntry({ entry, sink, handlers });
          },
          onError: (err: unknown) => {
            if (sink.closed) return;
            sink.error(err instanceof Error ? err.message : "Langy stream error");
          },
          onComplete: () => sink.finish("closed"),
        },
      );
      abortSignal?.addEventListener("abort", () => sink.abort());
    },
    cancel() {
      sub?.unsubscribe();
    },
  });
}

/** Map a live tool entry onto the AI-SDK tool chunks the renderers consume. */
function enqueueToolChunk(
  controller: Controller,
  entry: Extract<LangyStreamWireEntry, { type: "tool" }>,
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
