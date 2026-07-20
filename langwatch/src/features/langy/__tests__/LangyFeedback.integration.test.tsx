/**
 * @vitest-environment jsdom
 *
 * Langy feedback records the customer's rating through the backend feedback
 * capture. Beyond the four quick segments there is an inline 1-5 field: typing
 * a number and submitting must derive the same up/down + sentiment the segments
 * do, and carry the exact number along so the finer signal isn't lost.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { submitMock, promptShownMock } = vi.hoisted(() => ({
  submitMock: vi.fn(),
  promptShownMock: vi.fn(),
}));

vi.mock("../data/useLangyFeedback", () => ({
  useLangyFeedback: () => ({ submit: submitMock, isSubmitting: false }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    langy: {
      feedbackPromptShown: {
        useMutation: () => ({ mutate: promptShownMock }),
      },
    },
  },
}));

import { LangyFeedback } from "../components/LangyFeedback";
import { useLangyStore } from "../stores/langyStore";

function renderFeedback(
  props: Partial<React.ComponentProps<typeof LangyFeedback>> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyFeedback
        conversationId="conv-1"
        messageId="msg-1"
        traceId="trace-1"
        {...props}
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  submitMock.mockClear();
  promptShownMock.mockClear();
  useLangyStore.setState({
    pinnedFeedbackMessageId: null,
    dismissedFeedbackMessageIds: new Set<string>(),
  });
});

describe("given the Langy feedback card", () => {
  describe("when a quick segment is chosen", () => {
    it("records the segment's derived rating and sentiment", () => {
      renderFeedback();
      fireEvent.click(screen.getByText("Bad"));
      expect(submitMock).toHaveBeenCalledTimes(1);
      expect(submitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          messageId: "msg-1",
          traceId: "trace-1",
          rating: "down",
          sentiment: "frustrated",
        }),
      );
    });
  });

  describe("when a top score is typed inline", () => {
    it("records an up-rating, a delighted sentiment, and the exact number", () => {
      renderFeedback();
      const input = screen.getByLabelText("Rate Langy from 1 to 5");
      fireEvent.change(input, { target: { value: "5" } });
      fireEvent.click(screen.getByLabelText("Submit typed rating"));
      expect(submitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rating: "up",
          sentiment: "delighted",
          comment: "Rated 5 out of 5",
        }),
      );
    });
  });

  describe("when a low score is typed inline", () => {
    it("records a down-rating with a frustrated sentiment", () => {
      renderFeedback();
      const input = screen.getByLabelText("Rate Langy from 1 to 5");
      fireEvent.change(input, { target: { value: "1" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(submitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rating: "down",
          sentiment: "frustrated",
          comment: "Rated 1 out of 5",
        }),
      );
    });
  });

  describe("when no number has been typed", () => {
    it("does not submit on an empty inline field", () => {
      renderFeedback();
      fireEvent.click(screen.getByLabelText("Submit typed rating"));
      expect(submitMock).not.toHaveBeenCalled();
    });
  });

  describe("when the card is shown by the backend cadence", () => {
    it("reports the ask so the quiet period starts even if it is ignored", () => {
      renderFeedback({ origin: "asked" });
      expect(promptShownMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        conversationId: "conv-1",
      });
    });

    it("pins itself so a refetch cannot unmount it mid-look", () => {
      renderFeedback({ origin: "asked" });
      expect(useLangyStore.getState().pinnedFeedbackMessageId).toBe("msg-1");
    });
  });

  describe("when the card is summoned via /feedback", () => {
    it("does not count against the quiet period", () => {
      renderFeedback({ origin: "requested" });
      expect(promptShownMock).not.toHaveBeenCalled();
    });
  });

  describe("when the card was already dismissed for this answer", () => {
    it("stays dismissed on a remount instead of resurrecting itself", () => {
      useLangyStore.setState({
        dismissedFeedbackMessageIds: new Set(["msg-1"]),
      });
      renderFeedback({ origin: "asked" });
      expect(screen.queryByText("How did Langy do?")).toBeNull();
      expect(useLangyStore.getState().pinnedFeedbackMessageId).toBeNull();
      expect(promptShownMock).not.toHaveBeenCalled();
    });
  });
});
