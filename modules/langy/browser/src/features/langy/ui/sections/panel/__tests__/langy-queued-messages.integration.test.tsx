/**
 * The queued messages at the end of the thread: each can be edited back into the composer or
 * removed before Langy picks it up.
 * @vitest-environment jsdom
 * @see modules/langy/specs/langy-queue-while-busy.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyStore } from "../../../../../../behavior/langy.store.ts";
import {
  type LangyDraftImage,
  useLangyComposerImages,
} from "../../../../../composer/behavior/langy-composer-images.store.ts";
import { useLangyMessageQueue } from "../../../../../composer/behavior/langy-message-queue.store.ts";
import { LangyQueuedMessages } from "../langy-queued-messages.tsx";

const chart: LangyDraftImage = {
  key: "a",
  label: "[▣ chart.png]",
  fileName: "chart.png",
  mediaType: "image/png",
  status: "ready",
};

function renderQueue({ paused = false, onSendNow = vi.fn() } = {}) {
  render(
    <DesignSystemProvider forcedTheme="light">
      <LangyQueuedMessages paused={paused} onSendNow={onSendNow} />
    </DesignSystemProvider>,
  );
  return { onSendNow };
}

beforeEach(() => {
  useLangyStore.setState({ draft: "", activeConversationId: "conv-1" });
  useLangyComposerImages.setState({ images: [], lastSent: [] });
  useLangyMessageQueue.setState({
    messages: [
      {
        id: "q1",
        conversationId: "conv-1",
        text: "what does [▣ chart.png] show?",
        images: [chart],
      },
      { id: "q2", conversationId: "conv-2", text: "another conversation", images: [] },
    ],
    held: {},
  });
});

afterEach(cleanup);

describe("given a message is queued while Langy works", () => {
  /** @scenario A message sent while Langy works waits in the thread as queued */
  it("shows it marked as queued, with its image by name, and only this conversation's", () => {
    renderQueue();

    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByText("what does chart.png show?")).toBeTruthy();
    expect(screen.queryByText("another conversation")).toBeNull();
  });

  describe("when I press Edit on it", () => {
    /** @scenario A queued message can be edited before it is sent */
    it("puts its text and image back in the composer and takes it out of the queue", () => {
      renderQueue();

      fireEvent.click(screen.getByRole("button", { name: "Edit queued message" }));

      expect(useLangyStore.getState().draft).toBe("what does [▣ chart.png] show?");
      expect(useLangyComposerImages.getState().images).toEqual([chart]);
      expect(useLangyMessageQueue.getState().messages.map((message) => message.id)).toEqual(["q2"]);
      expect(screen.queryByText("Queued")).toBeNull();
    });
  });

  describe("when I press Remove on it", () => {
    /** @scenario A queued message can be removed */
    it("leaves the thread and the queue", () => {
      renderQueue();

      fireEvent.click(screen.getByRole("button", { name: "Remove queued message" }));

      expect(screen.queryByText("what does chart.png show?")).toBeNull();
      expect(useLangyMessageQueue.getState().messages.map((message) => message.id)).toEqual(["q2"]);
      expect(useLangyStore.getState().draft).toBe("");
    });
  });

  describe("when the last turn failed or was stopped", () => {
    /** @scenario A turn that fails keeps the queued messages */
    it("offers Send now", () => {
      const { onSendNow } = renderQueue({ paused: true });

      fireEvent.click(screen.getByRole("button", { name: "Send now" }));

      expect(onSendNow).toHaveBeenCalledTimes(1);
    });
  });
});
