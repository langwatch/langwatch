/**
 * @vitest-environment jsdom
 * The `question` tool renders as the plain choices card: no derived frame, and a bare
 * question draws its words as reply prose. Boundary mocks: router, project hook, tRPC client.
 * @see specs/langy/langy-choice-questions.feature
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

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: { useUtils: () => ({}) },
}));

import { langyChoicesTimeline } from "../../../../../model/langy-choices-timeline.ts";
import { MessageContent } from "../message-content.tsx";

afterEach(cleanup);

const choicesCards = () => document.querySelectorAll("[data-langy-choices-card]");

const AGENT_QUESTION = {
  questions: [
    {
      question: "Which agent should the scenario run against?",
      header: "Agent",
      options: [
        { label: "Staging agent", description: "The safe one" },
        { label: "Production agent" },
      ],
      multiple: false,
    },
  ],
};

function questionToolPart(input: unknown = AGENT_QUESTION): UIMessage["parts"][number] {
  return { type: "tool-question", toolCallId: "call-q1", state: "input-available", input };
}

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return { id: "m-assistant", role: "assistant", parts };
}

function renderMessage(
  message: UIMessage,
  extra: Partial<Parameters<typeof MessageContent>[0]> = {},
) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <MessageContent
        message={message}
        conversationId="conv-1"
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        choicesTimeline={langyChoicesTimeline([message])}
        {...extra}
      />
    </DesignSystemProvider>,
  );
}

const PROPOSAL =
  "Now that your agent is integrated, I think we should write some tests for it. The first one I'd write is **Guest completes checkout**, because it is the golden path.";

const bareQuestion = () =>
  questionToolPart({
    questions: [
      {
        question: PROPOSAL,
        bare: true,
        options: [
          { label: 'Create "Guest completes checkout" as your first scenario test' },
          { label: "Chat about this", quiet: true },
        ],
      },
    ],
  });

describe("the question tool card", () => {
  describe("given an assistant turn waiting on its question tool call", () => {
    describe("when the message renders", () => {
      /** @scenario "A question is an ask, not a view Langy composed" */
      it("draws the choices card titled by the question itself, without the derived frame", () => {
        renderMessage(assistantMessage([questionToolPart()]));

        expect(choicesCards().length).toBe(1);
        expect(
          screen.getByText("Which agent should the scenario run against?"),
        ).toBeInTheDocument();
        expect(screen.getByText("Staging agent")).toBeInTheDocument();
        expect(document.querySelector("[data-derived-by-langy]")).toBeNull();
        expect(screen.queryByText("Made by Langy")).toBeNull();
      });

      /** @scenario "A bare question draws its words as prose above the options" */
      it("draws the question as reply prose, not a title, when the question is bare", () => {
        renderMessage(assistantMessage([bareQuestion()]), { onChoiceSelect: vi.fn() });

        const card = choicesCards()[0]!;
        expect(card.getAttribute("data-choices-bare")).toBe("true");
        const prose = card.querySelector("[data-langy-choices-prose]");
        expect(prose).not.toBeNull();
        expect(prose!.textContent).toContain("Now that your agent is integrated");
        expect(prose!.querySelector("strong")?.textContent).toBe("Guest completes checkout");
        const options = card.querySelectorAll("[data-testid='langy-choice-option']");
        expect(options.length).toBe(2);
        expect(
          prose!.compareDocumentPosition(options[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          screen.getByRole("button", {
            name: 'Create "Guest completes checkout" as your first scenario test',
          }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Chat about this" })).toBeInTheDocument();
      });

      /** @scenario "A bare question offers no Other row" */
      it("offers no Other row on a bare question, and keeps it on one that is not bare", () => {
        const { unmount } = renderMessage(assistantMessage([bareQuestion()]), {
          onChoiceSelect: vi.fn(),
        });
        expect(screen.queryByRole("button", { name: "Other…" })).toBeNull();
        unmount();

        renderMessage(assistantMessage([questionToolPart()]), { onChoiceSelect: vi.fn() });
        expect(screen.getByRole("button", { name: "Other…" })).toBeInTheDocument();
      });

      it("keeps the title for a question that is not bare", () => {
        renderMessage(assistantMessage([questionToolPart()]));

        const card = choicesCards()[0]!;
        expect(card.querySelector("[data-langy-choices-prose]")).toBeNull();
        expect(card.getAttribute("data-choices-bare")).toBeNull();
      });
    });
  });
});
