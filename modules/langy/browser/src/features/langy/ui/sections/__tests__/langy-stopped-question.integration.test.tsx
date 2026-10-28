/**
 * @vitest-environment jsdom
 *
 * A question the user stopped is closed by the card itself, never drawn as a failed step.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/use-langy-dev-mode.ts", () => ({
  useLangyDevMode: () => [false, vi.fn()],
}));

const { LangyToolActivity } = await import("../langy-tool-activity.tsx");

const questionInput = {
  questions: [
    {
      question: "Which colour do you prefer?",
      header: "Pick a colour",
      options: [{ label: "Red" }, { label: "Blue" }],
    },
  ],
};

function questionPart(errorText: string) {
  return {
    type: "tool-question",
    toolCallId: "call-q",
    state: "output-error",
    input: questionInput,
    errorText,
  } as never;
}

const reply = { type: "text", text: "Here is what I found." } as never;

function renderActivity(parts: UIMessage["parts"]) {
  const message: UIMessage = { id: "assistant-1", role: "assistant", parts };
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyToolActivity message={message} live={false} />
    </DesignSystemProvider>,
  );
}

describe("a question tool call on a settled turn", () => {
  describe("given the user stopped the turn while the question waited", () => {
    /** @scenario A question card I stopped reads as closed, not as failed */
    it("draws no failed-step line for it", () => {
      const { container } = renderActivity([
        questionPart(
          "cancelled: the turn was stopped, so the call on the user's machine was stopped too",
        ),
        reply,
      ]);

      expect(container.textContent).not.toContain("failed");
      expect(container.textContent).not.toContain("carried on");
    });
  });

  describe("given the question failed for another reason", () => {
    it("still draws the failure", () => {
      const { container } = renderActivity([
        questionPart("The question could not be shown. Ask the user in words."),
        reply,
      ]);

      expect(container.textContent).toContain("carried on");
    });
  });
});
