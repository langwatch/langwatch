/**
 * @vitest-environment jsdom
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { useLangyPanelSend } from "../panel/use-langy-panel-send.ts";

const ready: LangyDraftImage = {
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

function render() {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(
    () =>
      useLangyPanelSend({
        projectId: "proj_1",
        isBusy: false,
        latestAssistantMessageId: void 0,
        lastSentTextRef: { current: null },
        resetRecovery: vi.fn(),
        sendMessage,
        restoreDraftOnFailure: vi.fn(),
      }),
    {
      wrapper: ({ children }) => (
        <RecordingAnalyticsProvider analytics={new RecordingUiAnalytics()}>
          {children}
        </RecordingAnalyticsProvider>
      ),
    },
  );
  return { send: result.current, sendMessage };
}

beforeEach(() => {
  useLangyMessageQueue.setState({ messages: [], held: {} });
  useLangyStore.setState({ draft: "", turnPhase: "idle" });
  useLangyComposerImages.setState({ images: [], lastSent: [] });
});

describe("useLangyPanelSend with images in the composer", () => {
  describe("given an image whose upload failed", () => {
    /** @scenario A failed upload leaves a failed thumbnail that blocks sending */
    it("sends nothing from the composer and keeps the image", async () => {
      const failed = { ...ready, status: "failed" as const, attachment: undefined };
      useLangyComposerImages.setState({ images: [failed] });
      const { send, sendMessage } = render();

      await act(() => send("Compare two runs", { askedFrom: "composer" }));

      expect(sendMessage).not.toHaveBeenCalled();
      expect(useLangyComposerImages.getState().images).toEqual([failed]);
    });
  });

  describe("given an image whose upload was confirmed", () => {
    /** @scenario A confirmed image becomes a file part of the sent message */
    it("sends the text and the image's file part", async () => {
      useLangyComposerImages.setState({ images: [ready] });
      const { send, sendMessage } = render();

      await act(() => send("What does [▣ chart.png] show?", { askedFrom: "composer" }));

      expect(sendMessage).toHaveBeenCalledWith({
        role: "user",
        parts: [
          { type: "text", text: "What does [▣ chart.png] show?" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "chart.png",
            url: "/api/files/proj_1/storedobject_a/chart.png",
          },
        ],
      });
    });

    /** @scenario A confirmed image becomes a file part of the sent message */
    it("leaves the composer's images alone for a message the panel sends itself", async () => {
      useLangyComposerImages.setState({ images: [ready] });
      const { send, sendMessage } = render();

      await act(() => send("Explain this board"));

      expect(sendMessage).toHaveBeenCalledWith({
        role: "user",
        parts: [{ type: "text", text: "Explain this board" }],
      });
      expect(useLangyComposerImages.getState().images).toEqual([ready]);
    });
  });
});
