/**
 * The transcript passes each message whether it is the last, so an empty reply speaks only at
 * the end of the conversation.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-stop-and-resume.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p_demo", slug: "demo" } }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: { useUtils: () => ({}) },
}));

import { LangyTranscript, type LangyMessageContext } from "../panel/langy-panel-conversation.tsx";

afterEach(cleanup);

const question: UIMessage = { id: "m-q", role: "user", parts: [{ type: "text", text: "slow?" }] };
const emptyReply: UIMessage = {
  id: "m-empty",
  role: "assistant",
  parts: [{ type: "text", text: "" }],
};
const answer: UIMessage = {
  id: "m-answer",
  role: "assistant",
  parts: [{ type: "text", text: "Two traces are slow." }],
};

const context: LangyMessageContext = {
  appliedOutcomes: {},
  discardedProposals: new Set(),
  applyingProposals: new Set(),
  onApply: async () => {},
  onDiscard: () => {},
  displayBusy: false,
  interruptedHere: false,
  feedbackAllowed: false,
  pinnedFeedbackMessageId: null,
};

function renderTranscript({ messages }: { messages: UIMessage[] }) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyTranscript
        floating={false}
        messages={messages}
        context={context}
        cardAnchorIndex={-1}
        waitingCards={null}
        queuedPrompt={null}
        workingLine={null}
      />
    </DesignSystemProvider>,
  );
}

describe("given a transcript holding an empty settled reply", () => {
  describe("when a later message follows it", () => {
    /** @scenario An empty reply with messages after it draws nothing */
    it("draws no No content line anywhere in the conversation", () => {
      renderTranscript({ messages: [question, emptyReply, answer] });

      expect(screen.getByText("Two traces are slow.")).toBeInTheDocument();
      expect(screen.queryByText("No content")).toBeNull();
    });
  });

  describe("when it is the last message", () => {
    /** @scenario An empty reply at the end of the conversation still says so */
    it("says No content", () => {
      renderTranscript({ messages: [question, emptyReply] });

      expect(screen.getByText("No content")).toBeInTheDocument();
    });
  });
});
