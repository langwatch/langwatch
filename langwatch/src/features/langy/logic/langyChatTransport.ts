import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { Unsubscribable } from "@trpc/server/observable";

import { trpcClient } from "~/utils/api";
import type { LangyStreamEntry } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type {
  LangyResourceContext,
  LangySkillContext,
} from "~/server/app-layer/langy/langyTurnContext.schema";

/**
 * The per-turn request inputs the transport owns. Sourcing them HERE (from the
 * panel's live state via a getter), rather than from the AI-SDK per-send `body`,
 * is what fixes the regenerate 400: `regenerate()` carries no body, but the
 * transport still has the projectId + context, so a re-drive is a valid request.
 */
export interface LangyTurnRequestContext {
  projectId: string;
  conversationId: string | null;
  modelOverride?: string;
  pageContext?: LangyResourceContext[];
  skills?: LangySkillContext[];
}

/**
 * A live signal routed out-of-band (not a message part): status/progress/
 * milestone/reasoning tick the status line + thinking line; `plan` mirrors the
 * manager's typed plan snapshot into the store, which the plan card prefers over
 * parsing the raw `todowrite` tool part.
 */
export type LangyTurnSignalEntry = Extract<
  LangyStreamEntry,
  { type: "status" | "progress" | "milestone" | "reasoning" | "plan" }
>;

/**
 * How a turn stream terminated. "end" is the genuine end-of-turn frame — the
 * answer is complete, so the caller may retire in-flight UI immediately.
 * "closed" is a silent close (the subscription completed without an end frame —
 * e.g. a quiet worker); the durable fold remains the only truth there.
 */
export type LangyTurnSettleReason = "end" | "error" | "closed";

export interface LangyChatTransportDeps {
  /** Read the current turn inputs at send time (owns projectId → fixes regenerate). */
  getContext: () => LangyTurnRequestContext;
  /** Adopt the conversation + turn the server started (replaces the header scrape). */
  onIds: (ids: { conversationId: string; turnId: string }) => void;
  /** Push a status/progress/milestone signal (drives StreamingStatusLine via the store). */
  onSignal: (signal: LangyTurnSignalEntry) => void;
  /** Fired when a turn stream terminates — the reconcile trigger. */
  onTurnSettled?: (info: { reason: LangyTurnSettleReason }) => void;
}

/** The turn-start response the create/continue mutations return (ids, no stream). */
interface StartTurnResponse {
  conversationId: string;
  turnId: string;
}

/**
 * A custom AI-SDK `ChatTransport` for Langy. `sendMessages` starts the turn via
 * the `langy.createConversation` / `langy.continueConversation` tRPC mutations —
 * which return only `{conversationId, turnId}` — then bridges the
 * `langy.onTurnStream` tRPC subscription into the `ReadableStream<UIMessageChunk>`
 * `useChat` expects. Same chunk contract the old `attachTurnStream` produced, so
 * every parts renderer is unchanged.
 *
 * Create vs continue is one operation split by whether we already hold a
 * conversation id: no id yet ⇒ `createConversation` (mints the id + emits the
 * semantically-first `conversation_started`); an id ⇒ `continueConversation`.
 *
 * A rejected mutation throws its typed domain error to `useChat().error`, which
 * `readLangyTrpcError`/`explainLangyError` render as a proper card.
 *
 * Status/progress/milestone entries are NOT emitted as message parts (nothing
 * consumes `data-langy-*`); they go to `onSignal` and light up the status line
 * through the store. The durable truth is reloaded by the `messages` query when
 * `onTurnSettled` fires.
 */
export function createLangyChatTransport(
  deps: LangyChatTransportDeps,
): ChatTransport<UIMessage> {
  return {
    async sendMessages(options) {
      const ctx = deps.getContext();
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

      // The vanilla client's proxy inference collapses on this router (see
      // api.tsx / the onTurnStream call below), so invoke the mutation by dotted
      // path and cast — the same escape hatch the subscription path uses.
      //
      // The call MUST stay attached to `trpcClient`. `TRPCUntypedClient.mutation`
      // runs `this.requestAsPromise(...)`, so a detached `const mutate =
      // trpcClient.mutation` drops `this` and throws "Cannot read properties of
      // undefined (reading 'requestAsPromise')" synchronously — before any
      // request leaves the browser. The arrow keeps the property access inline
      // (like the api.tsx sibling and the onTurnStream call below), so `this` is
      // bound to the client.
      const mutate = (
        path: string,
        input: unknown,
      ): Promise<StartTurnResponse> =>
        (
          trpcClient.mutation as (
            path: string,
            input: unknown,
          ) => Promise<StartTurnResponse>
        )(path, input);
      const { conversationId, turnId } = ctx.conversationId
        ? await mutate("langy.continueConversation", {
            ...turnInput,
            conversationId: ctx.conversationId,
          })
        : await mutate("langy.createConversation", turnInput);
      deps.onIds({ conversationId, turnId });

      return subscribeTurnStream({
        projectId: ctx.projectId,
        conversationId,
        turnId,
        onSignal: deps.onSignal,
        onSettled: deps.onTurnSettled,
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
  onSettled,
  abortSignal,
}: {
  projectId: string;
  conversationId: string;
  turnId: string;
  onSignal: (signal: LangyTurnSignalEntry) => void;
  onSettled?: (info: { reason: LangyTurnSettleReason }) => void;
  abortSignal?: AbortSignal;
}): ReadableStream<UIMessageChunk> {
  let sub: Unsubscribable | undefined;

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      const textId = crypto.randomUUID();
      let closed = false;

      const finish = (reason: LangyTurnSettleReason) => {
        if (closed) return;
        closed = true;
        controller.enqueue({ type: "text-end", id: textId });
        controller.enqueue({ type: "finish" });
        controller.close();
        sub?.unsubscribe();
        onSettled?.({ reason });
      };

      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "text-start", id: textId });

      // The manager emits a readiness status ("Waking Langy up…") into the cold window
      // (worker tool prep produces no frames for many seconds). It is a
      // placeholder for SILENCE, so the first real output — text, a tool, the
      // model's reasoning — retires it; without this the status line would
      // outrank the thinking line (and its reasoning glimpse) for the whole
      // turn. Cleared once: statuses the agent reports mid-turn keep today's
      // behavior.
      let sawOutput = false;
      const clearColdStartStatus = () => {
        if (sawOutput) return;
        sawOutput = true;
        onSignal({ type: "status", status: "" });
      };

      const onEntry = (entry: LangyStreamEntry) => {
        if (closed) return;
        switch (entry.type) {
          case "delta":
            clearColdStartStatus();
            controller.enqueue({ type: "text-delta", id: textId, delta: entry.text });
            return;
          case "tool":
            clearColdStartStatus();
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
          case "progress":
          case "milestone":
            onSignal(entry);
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

      // The vanilla client's proxy inference collapses on this router (see
      // api.tsx), so call the subscription by dotted path and cast — the same
      // escape hatch the mutation path uses.
      sub = (
        trpcClient.subscription as (
          path: string,
          input: unknown,
          opts: {
            onData: (entry: LangyStreamEntry) => void;
            onError: (err: unknown) => void;
            onComplete: () => void;
          },
        ) => Unsubscribable
      )(
        "langy.onTurnStream",
        { projectId, conversationId, turnId },
        {
          onData: onEntry,
          onError: (err) => {
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
