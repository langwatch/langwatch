/**
 * Sending while Langy works: the message is queued, then sent as one follow-up turn when the turn
 * ends, held instead after a failed or stopped turn.
 * @vitest-environment jsdom
 * @see modules/langy/specs/langy-queue-while-busy.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import {
  type LangyDraftImage,
  useLangyComposerImages,
} from "../../../composer/behavior/langy-composer-images.store.ts";
import { useLangyMessageQueue } from "../../../composer/behavior/langy-message-queue.store.ts";
import {
  RecordingAnalyticsProvider,
  RecordingUiAnalytics,
} from "../../__tests__/recording-analytics.test-helpers.tsx";
import { useLangyDraftRestore, useLangyPanelSend } from "../panel/use-langy-panel-send.ts";
import { holdQueueForStop, useLangyQueuedFollowUp } from "../panel/use-langy-queued-follow-up.ts";

const chart: LangyDraftImage = {
  key: "a",
  label: "[▣ chart.png]",
  fileName: "chart.png",
  mediaType: "image/png",
  status: "ready",
  attachment: {
    objectId: "storedobject_a",
    url: "/api/files/proj_1/storedobject_a/chart.png",
    filename: "chart.png",
    mediaType: "image/png",
    byteLength: 4,
  },
};

interface Turn {
  isBusy: boolean;
  failed: boolean;
}

function renderPanel({
  sendFails = false,
  projectId = "proj_1",
}: { sendFails?: boolean; projectId?: string } = {}) {
  const sendMessage = sendFails
    ? vi.fn().mockRejectedValue(new Error("network down"))
    : vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    ({ isBusy, failed }: Turn) => {
      const lastSentTextRef = { current: null as string | null };
      const restoreDraftOnFailure = useLangyDraftRestore({ lastSentTextRef });
      const send = useLangyPanelSend({
        projectId,
        isBusy,
        latestAssistantMessageId: void 0,
        lastSentTextRef,
        resetRecovery: vi.fn(),
        sendMessage,
        restoreDraftOnFailure,
      });
      const queue = useLangyQueuedFollowUp({
        projectId,
        isBusy,
        failed,
        recovering: false,
        send,
      });
      return { send, queue };
    },
    {
      initialProps: { isBusy: true, failed: false },
      wrapper: ({ children }) => (
        <RecordingAnalyticsProvider analytics={new RecordingUiAnalytics()}>
          {children}
        </RecordingAnalyticsProvider>
      ),
    },
  );
  /** The running turn ends; `failed` says it ended in an error. */
  const endTurn = async ({ failed = false }: { failed?: boolean } = {}) => {
    useLangyStore.setState({ turnPhase: "idle" });
    await act(async () => hook.rerender({ isBusy: false, failed }));
  };
  return { hook, sendMessage, endTurn };
}

const sentTexts = (sendMessage: ReturnType<typeof vi.fn>) =>
  sendMessage.mock.calls.map(([message]) => message.parts[0].text);

afterEach(() => {
  useLangyMessageQueue.setState({ messages: [], held: {} });
  useLangyStore.setState({ turnPhase: "idle", draft: "" });
});

beforeEach(() => {
  useLangyStore.setState({
    draft: "",
    turnPhase: "active",
    activeConversationId: "conv-1",
    historyLoadConversationId: "conv-1",
  });
  useLangyComposerImages.setState({ images: [], lastSent: [] });
  useLangyMessageQueue.setState({ messages: [], held: {} });
});

describe("given Langy is working on a turn", () => {
  describe("when I send a message from the composer", () => {
    /** @scenario A message sent while Langy works waits in the thread as queued */
    it("queues it, empties the composer and starts no second turn", async () => {
      const { hook, sendMessage } = renderPanel();
      useLangyStore.setState({ draft: "make it red" });

      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));

      expect(sendMessage).not.toHaveBeenCalled();
      expect(useLangyStore.getState().draft).toBe("");
      expect(useLangyMessageQueue.getState().messages).toEqual([
        expect.objectContaining({ conversationId: "conv-1", text: "make it red" }),
      ]);
    });
  });

  describe("when the turn ends with two messages queued", () => {
    /** @scenario Queued messages go as one follow-up turn when the turn ends */
    it("sends both as one message, in order, and empties the queue", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));
      await act(() => hook.result.current.send("or red-ish, pastel", { askedFrom: "composer" }));

      await endTurn();

      expect(sentTexts(sendMessage)).toEqual(["make it red\n\nor red-ish, pastel"]);
      expect(useLangyMessageQueue.getState().messages).toEqual([]);
    });
  });

  describe("when the queued message has an image", () => {
    /** @scenario Images attached to a queued message go with it */
    it("sends the image as a file part of the follow-up", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      useLangyComposerImages.setState({ images: [chart] });
      await act(() =>
        hook.result.current.send("what does [▣ chart.png] show?", { askedFrom: "composer" }),
      );
      expect(useLangyComposerImages.getState().images).toEqual([]);

      await endTurn();

      expect(sendMessage).toHaveBeenCalledWith({
        role: "user",
        parts: [
          { type: "text", text: "what does [▣ chart.png] show?" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "chart.png",
            url: "/api/files/proj_1/storedobject_a/chart.png",
          },
        ],
      });
    });
  });

  describe("when the running turn fails", () => {
    /** @scenario A turn that fails keeps the queued messages */
    it("keeps the message queued until Send now", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));

      await endTurn({ failed: true });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(hook.result.current.queue.paused).toBe(true);
      expect(useLangyMessageQueue.getState().messages).toHaveLength(1);

      await act(async () => hook.result.current.queue.sendNow());
      expect(sentTexts(sendMessage)).toEqual(["make it red"]);
    });
  });

  describe("when I press Stop", () => {
    /** @scenario Stopping keeps the queued messages */
    it("keeps the message queued until Send now", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));

      holdQueueForStop();
      await endTurn();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(hook.result.current.queue.paused).toBe(true);

      await act(async () => hook.result.current.queue.sendNow());
      expect(sentTexts(sendMessage)).toEqual(["make it red"]);
    });
  });

  describe("when I open another conversation before the turn ends", () => {
    /** @scenario A queued message waits for its own conversation */
    it("sends it only once its own conversation is open and idle", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));

      useLangyStore.setState({ activeConversationId: "conv-2" });
      await endTurn();
      expect(sendMessage).not.toHaveBeenCalled();

      await act(async () => useLangyStore.setState({ activeConversationId: "conv-1" }));
      expect(sentTexts(sendMessage)).toEqual(["make it red"]);
    });
  });

  describe("when the follow-up's send fails before a turn starts", () => {
    /** @scenario A follow-up whose send fails gives the words back */
    it("puts the text and the images back in the composer", async () => {
      const { hook, endTurn } = renderPanel({ sendFails: true });
      useLangyComposerImages.setState({ images: [chart] });
      await act(() =>
        hook.result.current.send("what does [▣ chart.png] show?", { askedFrom: "composer" }),
      );

      await endTurn();

      expect(useLangyStore.getState().draft).toBe("what does [▣ chart.png] show?");
      expect(useLangyComposerImages.getState().images).toEqual([chart]);
    });
  });

  describe("when the follow-up's send fails while I am typing something new", () => {
    /** @scenario A follow-up whose send fails gives the words back */
    it("leaves my typing alone and holds the words in the queue for Send now", async () => {
      const { hook, endTurn } = renderPanel({ sendFails: true });
      useLangyComposerImages.setState({ images: [chart] });
      await act(() =>
        hook.result.current.send("what does [▣ chart.png] show?", { askedFrom: "composer" }),
      );
      useLangyStore.setState({ draft: "and the next one" });

      await endTurn();

      expect(useLangyStore.getState().draft).toBe("and the next one");
      expect(useLangyMessageQueue.getState().messages).toEqual([
        expect.objectContaining({ text: "what does [▣ chart.png] show?", images: [chart] }),
      ]);
      expect(hook.result.current.queue.paused).toBe(true);
    });
  });

  describe("when I send my own words with a new image after the turn and the send fails", () => {
    /** @scenario A follow-up whose send fails gives the words back */
    it("gives back the new image with its preview still showing", async () => {
      const revoke = vi.fn();
      vi.stubGlobal(
        "URL",
        class extends URL {
          static override revokeObjectURL = revoke;
        },
      );
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const { hook, endTurn } = renderPanel({ sendFails: true });
      useLangyStore.setState({ turnPhase: "stopping" });
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));
      await endTurn();
      const shot = { ...chart, previewUrl: "blob:shot" };
      useLangyComposerImages.setState({ images: [shot] });

      await act(() => hook.result.current.send("and this one", { askedFrom: "composer" }));

      expect(useLangyComposerImages.getState().images).toEqual([shot]);
      expect(revoke).not.toHaveBeenCalledWith("blob:shot");
    });
  });

  describe("when I keep typing while the queued message goes", () => {
    /** @scenario What I am typing stays when the queued messages go */
    it("sends the queued message and leaves my typing in the composer", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));
      useLangyStore.setState({ draft: "half a thought" });

      await endTurn();

      expect(sentTexts(sendMessage)).toEqual(["make it red"]);
      expect(useLangyStore.getState().draft).toBe("half a thought");
    });
  });

  describe("when I press Stop with nothing queued and send before the turn stops", () => {
    /** @scenario A message sent while a stop settles waits for Send now */
    it("holds the message for Send now", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      holdQueueForStop();
      useLangyStore.setState({ turnPhase: "stopping" });

      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));
      await endTurn();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(hook.result.current.queue.paused).toBe(true);
    });
  });

  describe("when no project is open as the turn ends", () => {
    /** @scenario Queued messages wait while no project is open */
    it("keeps the message queued", async () => {
      const { hook, sendMessage, endTurn } = renderPanel({ projectId: "" });
      useLangyMessageQueue.getState().enqueue({
        id: "q1",
        conversationId: "conv-1",
        text: "make it red",
        images: [],
      });

      await endTurn();
      await act(async () => hook.result.current.queue.sendNow());

      expect(sendMessage).not.toHaveBeenCalled();
      expect(useLangyMessageQueue.getState().messages).toHaveLength(1);
    });
  });
});

describe("given a message is queued during a new chat's first turn", () => {
  beforeEach(() => {
    useLangyStore.setState({ activeConversationId: null, historyLoadConversationId: null });
  });

  describe("when that turn names the new chat", () => {
    /** @scenario A queued message waits for its own conversation */
    it("moves the message to the named chat and sends it there", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));

      await act(async () => useLangyStore.getState().adoptConversation("conv-new"));
      await endTurn();

      expect(sentTexts(sendMessage)).toEqual(["make it red"]);
    });
  });

  describe("when I open an existing conversation first", () => {
    /** @scenario A new chat's queued messages never go to a conversation I pick */
    it("sends nothing there and holds the message with the new chat", async () => {
      const { hook, sendMessage, endTurn } = renderPanel();
      await act(() => hook.result.current.send("make it red", { askedFrom: "composer" }));

      await act(async () => useLangyStore.getState().selectConversation("conv-2"));
      await endTurn();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(useLangyMessageQueue.getState().messages).toEqual([
        expect.objectContaining({ conversationId: null, text: "make it red" }),
      ]);
      expect(useLangyMessageQueue.getState().held).toEqual({ "": true });
    });
  });
});
