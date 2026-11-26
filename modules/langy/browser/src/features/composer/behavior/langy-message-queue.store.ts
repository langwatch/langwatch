/**
 * Messages the person sent while Langy was working, held per conversation until the turn ends.
 * Held queues (after a failed or stopped turn) wait for Send now instead of going on their own.
 * Spec: modules/langy/specs/langy-queue-while-busy.feature
 */
import { defineSlice } from "@langwatch/browser-host/global-store";

import type { LangyDraftImage } from "./langy-composer-images.store.ts";

export type LangyQueuedMessage = Readonly<{
  id: string;
  /** The conversation it was sent in; null while that conversation has no id yet. */
  conversationId: string | null;
  text: string;
  images: readonly LangyDraftImage[];
}>;

/** The key a conversation's hold is kept under: a conversation with no id yet is "". */
const holdKey = (conversationId: string | null) => conversationId ?? "";

interface LangyMessageQueueState {
  messages: readonly LangyQueuedMessage[];
  held: Readonly<Record<string, true>>;
  enqueue: (message: LangyQueuedMessage) => void;
  /** Takes one message out of the queue, as Edit and Remove do. */
  takeOne: (id: string) => LangyQueuedMessage | undefined;
  /** Takes every message of a conversation out of the queue, in order, to send them. */
  takeAll: (conversationId: string | null) => readonly LangyQueuedMessage[];
  hold: (conversationId: string | null) => void;
  release: (conversationId: string | null) => void;
  /** The conversation that had no id got one: its queued messages and hold follow it. */
  adopt: (conversationId: string) => void;
}

function revoke(images: readonly LangyDraftImage[]) {
  for (const image of images) {
    if (image.previewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

export const useLangyMessageQueue = defineSlice<LangyMessageQueueState>({
  name: "langy:message-queue",
  create: (set, get) => ({
    messages: [],
    held: {},
    enqueue: (message) => set((s) => ({ messages: [...s.messages, message] })),
    takeOne: (id) => {
      const message = get().messages.find((queued) => queued.id === id);
      if (!message) return undefined;
      set((s) => ({ messages: s.messages.filter((queued) => queued.id !== id) }));
      return message;
    },
    takeAll: (conversationId) => {
      const taken = get().messages.filter((queued) => queued.conversationId === conversationId);
      if (taken.length === 0) return taken;
      set((s) => ({
        messages: s.messages.filter((queued) => queued.conversationId !== conversationId),
      }));
      return taken;
    },
    hold: (conversationId) =>
      set((s) => ({ held: { ...s.held, [holdKey(conversationId)]: true } })),
    release: (conversationId) =>
      set((s) => {
        const { [holdKey(conversationId)]: _released, ...held } = s.held;
        return { held };
      }),
    adopt: (conversationId) =>
      set((s) => {
        if (!s.messages.some((queued) => queued.conversationId === null)) return s;
        const { [holdKey(null)]: wasHeld, ...held } = s.held;
        return {
          messages: s.messages.map((queued) =>
            queued.conversationId === null ? { ...queued, conversationId } : queued,
          ),
          held: wasHeld ? { ...held, [conversationId]: true } : held,
        };
      }),
  }),
});

/** Drops a removed message's image previews, which nothing else holds. */
export function discardQueuedMessage(message: LangyQueuedMessage): void {
  revoke(message.images);
}

/** Whether the conversation's queue waits for Send now. */
export function isQueueHeld({
  held,
  conversationId,
}: {
  held: Readonly<Record<string, true>>;
  conversationId: string | null;
}): boolean {
  return held[holdKey(conversationId)] === true;
}
