/**
 * A reply made only of a said line and the code access call renders both.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-code-access.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("../../../../../ui/sections/derived-cards/langy-code-access-card.tsx", () => ({
  LangyCodeAccessCard: ({ callId }: { callId: string }) => (
    <div data-testid="code-access-card">{callId}</div>
  ),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: { useUtils: () => ({}) },
}));

import { MessageContent } from "../message-content.tsx";

afterEach(cleanup);

const SAID = "Ok, let's set up your agent with LangWatch. Can I access your code?";

const sayThenAskForCode: UIMessage = {
  id: "m-assistant",
  role: "assistant",
  parts: [
    {
      type: "tool-say",
      toolCallId: "call-say",
      state: "output-available",
      input: { text: SAID },
      output: "Said.",
    },
    {
      type: "tool-code_access",
      toolCallId: "call-code",
      state: "output-available",
      input: { reason: "wire tracing in", offer_describe: true },
      output: "The code access card is shown to the user.",
    },
    { type: "text", text: "" },
  ],
};

describe("given a settled reply that only says a line and asks for code access", () => {
  describe("when it renders", () => {
    /** @scenario A reply that only says a line and asks for code access shows both */
    it("shows the said line and the code access card instead of No content", () => {
      render(
        <DesignSystemProvider forcedTheme="light">
          <MessageContent
            message={sayThenAskForCode}
            conversationId="conv-1"
            appliedOutcomes={{}}
            discardedProposals={new Set()}
            applyingProposals={new Set()}
            onApply={async () => {}}
            onDiscard={() => {}}
          />
        </DesignSystemProvider>,
      );

      expect(screen.getByText(SAID)).toBeInTheDocument();
      expect(screen.getByTestId("code-access-card")).toHaveTextContent("call-code");
      expect(screen.queryByText("No content")).toBeNull();
    });
  });
});
