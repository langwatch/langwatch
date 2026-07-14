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
import { afterEach, describe, expect, it, vi } from "vitest";

const { submitMock } = vi.hoisted(() => ({ submitMock: vi.fn() }));

vi.mock("../data/useLangyFeedback", () => ({
  useLangyFeedback: () => ({ submit: submitMock, isSubmitting: false }),
}));

import { LangyFeedback } from "../components/LangyFeedback";

function renderFeedback() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyFeedback
        conversationId="conv-1"
        messageId="msg-1"
        traceId="trace-1"
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  submitMock.mockClear();
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
});
