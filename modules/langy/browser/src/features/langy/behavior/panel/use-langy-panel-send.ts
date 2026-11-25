import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { generate } from "@langwatch/ksuid";
import { type LangyAskSurface, langyQuestionAsked } from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { type RefObject, useCallback, useRef } from "react";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import {
  imageFileParts,
  imagesAllowSend,
  type LangyDraftImage,
  useLangyComposerImages,
} from "../../../composer/behavior/langy-composer-images.store.ts";
import { useLangyMessageQueue } from "../../../composer/behavior/langy-message-queue.store.ts";
import { langyDraftToRestore } from "../../../composer/model/langy-draft-recovery.ts";
import { langyFollowUpOf } from "../../../composer/model/langy-follow-up.ts";
import { useLangyDevLog } from "../stores/langy-dev-log.ts";

/** How one send behaves beyond its text. */
export interface LangySendOptions {
  /**
   * Give the text back to the composer if the send fails. False for a message the panel sends on
   * the reader's behalf: they never wrote it, so they must not be left holding it.
   */
  keepOnFailure?: boolean;
  /** Where the member asked it; set only for a question they wrote, which is then counted once. */
  askedFrom?: LangyAskSurface;
  /** The images this send carries, given by a queued follow-up instead of the composer's. */
  images?: readonly LangyDraftImage[];
}

export type LangyPanelSend = (text: string, options?: LangySendOptions) => Promise<void>;

/**
 * Give the user their words back when a send fails. A send that never reached a turn id leaves
 * nothing running, so the composer goes back to Send along with the words.
 */
export function useLangyDraftRestore({
  lastSentTextRef,
}: {
  lastSentTextRef: RefObject<string | null>;
}) {
  const setDraft = useLangyStore((s) => s.setDraft);
  return useCallback(() => {
    const text = langyDraftToRestore({
      sentText: lastSentTextRef.current,
      draft: useLangyStore.getState().draft,
    });
    lastSentTextRef.current = null;
    if (text) setDraft(text);
    if (text) useLangyComposerImages.getState().restoreLastSent();
    useLangyStore.getState().abandonSend();
  }, [setDraft, lastSentTextRef]);
}

/** The outbound lane's label for a send: its first 60 characters. */
function sendLabel(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** An image still uploading, or one that failed, holds back the person's own send. */
function composerImagesHoldSend({ askedFrom }: Pick<LangySendOptions, "askedFrom">): boolean {
  if (askedFrom !== "composer") return false;
  return !imagesAllowSend(useLangyComposerImages.getState().images);
}

/**
 * What one send carries. A queued follow-up brings its own images; the person's own words carry
 * the composer's images, plus anything still queued in this conversation, ahead of them.
 */
function sendPartsFor({
  text,
  askedFrom,
  images,
}: Pick<LangySendOptions, "askedFrom" | "images"> & { text: string }) {
  if (images) {
    useLangyComposerImages.getState().holdAsLastSent(images);
    return { text, images };
  }
  if (askedFrom !== "composer") return { text, images: [] };
  const conversationId = useLangyStore.getState().activeConversationId;
  const queue = useLangyMessageQueue.getState();
  const queued = queue.takeAll(conversationId);
  queue.release(conversationId);
  const own = { text, images: useLangyComposerImages.getState().takeForSend() };
  if (queued.length === 0) return own;
  const followUp = langyFollowUpOf([...queued, own]);
  useLangyComposerImages.getState().holdAsLastSent(followUp.images);
  return followUp;
}

/** While a turn runs, the person's own message waits in the queue instead of being refused. */
function queueWhileBusy({ text }: { text: string }): void {
  useLangyMessageQueue.getState().enqueue({
    id: generate("langy").toString(),
    conversationId: useLangyStore.getState().activeConversationId,
    text,
    images: useLangyComposerImages.getState().takeForQueue(),
  });
  useLangyStore.getState().setDraft("");
}

/**
 * What one send does: nothing, queue the person's words behind the running turn, summon the
 * rating card (`/feedback` is a client command), or start a turn.
 */
function sendRouteOf({
  text,
  askedFrom,
  given,
  projectId,
  isBusy,
}: Pick<LangySendOptions, "askedFrom"> & {
  text: string;
  given: LangySendOptions["images"];
  projectId: string | undefined;
  isBusy: boolean;
}): "ignore" | "queue" | "feedback" | "send" {
  if (!text.trim() || !projectId) return "ignore";
  if (!given && composerImagesHoldSend({ askedFrom })) return "ignore";
  const ownWords = askedFrom === "composer" && !given;
  const command = text.trim().toLowerCase() === "/feedback";
  const turnRunning = isBusy || (ownWords && useLangyStore.getState().turnPhase !== "idle");
  if (!turnRunning) return command ? "feedback" : "send";
  return ownWords && !command ? "queue" : "ignore";
}

/**
 * The panel's send, kept stable for the composer while its implementation reads this render's
 * context.
 */
export function useLangyPanelSend({
  projectId,
  isBusy,
  latestAssistantMessageId,
  lastSentTextRef,
  resetRecovery,
  sendMessage,
  restoreDraftOnFailure,
}: {
  projectId: string | undefined;
  isBusy: boolean;
  latestAssistantMessageId: string | undefined;
  lastSentTextRef: RefObject<string | null>;
  resetRecovery: () => void;
  sendMessage: (message: Pick<UIMessage, "role" | "parts">) => Promise<void>;
  restoreDraftOnFailure: () => void;
}): LangyPanelSend {
  const setDraft = useLangyStore((s) => s.setDraft);
  const analytics = useUiAnalytics();
  const implementationRef = useRef<LangyPanelSend>(async () => undefined);
  implementationRef.current = async (
    text: string,
    { keepOnFailure = true, askedFrom, images: given }: LangySendOptions = {},
  ) => {
    const route = sendRouteOf({ text, askedFrom, given, projectId, isBusy });
    if (route === "ignore") return;
    if (route === "queue") return queueWhileBusy({ text });
    setDraft("");
    if (route === "feedback") {
      if (latestAssistantMessageId) useLangyStore.getState().pinFeedback(latestAssistantMessageId);
      return;
    }
    const parts = sendPartsFor({ text, askedFrom, images: given });
    if (askedFrom) analytics.track(langyQuestionAsked({ surface: askedFrom }));
    // A new question opens a new recovery chain: the attempt budget is per question.
    resetRecovery();
    // Remembered for restoreDraftOnFailure: `sendMessage` routes failures to useChat's `error`.
    lastSentTextRef.current = keepOnFailure ? parts.text : null;
    // The turn is in flight from HERE: Stop is available at once, and a click
    // before the turn is named is kept and dispatched as soon as it is.
    useLangyStore.getState().beginSend();
    try {
      useLangyDevLog.getState().recordOutbound("send", sendLabel(parts.text), {
        text: parts.text,
        conversationId: useLangyStore.getState().activeConversationId,
      });
      await sendMessage({
        role: "user",
        parts: [{ type: "text", text: parts.text }, ...imageFileParts(parts.images)],
      });
    } catch {
      restoreDraftOnFailure();
    }
  };
  return useCallback<LangyPanelSend>(
    (text, options) => implementationRef.current(text, options),
    [],
  );
}
