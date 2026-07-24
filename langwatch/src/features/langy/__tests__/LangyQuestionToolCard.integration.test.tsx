/**
 * @vitest-environment jsdom
 *
 * The agent's `question` TOOL renders as the interactive choices card
 * (ADR-060 §6, specs/langy/langy-choice-questions.feature) — never as a
 * generic activity card stuck on "Question…" with the payload as raw JSON.
 * The tool waits on the USER, so the card must be answerable through the
 * ordinary choices path, and a recorded selection must lock it exactly like
 * a stamped choices block.
 *
 * Boundary mocks: router, project hook, and the tRPC client (the choices
 * card's ref hydration) — same harness as LangyDerivedCards.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { UIMessage } from "ai";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({}),
  },
}));

import { MessageContent } from "../components/MessageContent";
import { langyChoicesTimeline } from "../logic/langyChoicesTimeline";
import { questionToolCardParts } from "../logic/langyQuestionTool";

afterEach(cleanup);

/** The frame the choices card renders inside — the ADR-060 provenance mark. */
const derivedFrames = () =>
  document.querySelectorAll("[data-derived-by-langy]");

/** A `question` tool part exactly as the stream delivers one — and leaves it. */
function questionToolPart(over: Record<string, unknown> = {}) {
  return {
    type: "tool-question",
    toolCallId: "call-q1",
    state: "input-available",
    input: {
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
    },
    ...over,
  };
}

function assistantMessage(parts: unknown[]): UIMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    parts,
    // Fixture boundary: tool parts aren't members of the SDK's per-state
    // union — the same honest cast the sibling card tests document.
  } as unknown as UIMessage;
}

function renderMessage(
  message: UIMessage,
  extra: Partial<Parameters<typeof MessageContent>[0]> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        choicesTimeline={langyChoicesTimeline([message])}
        {...extra}
      />
    </ChakraProvider>,
  );
}

describe("the question tool card", () => {
  describe("given an assistant turn waiting on its question tool call", () => {
    describe("when the message renders", () => {
      it("draws the interactive choices card, titled by the question itself", () => {
        renderMessage(assistantMessage([questionToolPart()]));

        expect(derivedFrames().length).toBe(1);
        expect(
          screen.getByText("Which agent should the scenario run against?"),
        ).toBeInTheDocument();
        expect(screen.getByText("Staging agent")).toBeInTheDocument();
        expect(screen.getByText("The safe one")).toBeInTheDocument();
        expect(screen.getByText("Production agent")).toBeInTheDocument();
      });

      it("never renders the tool as raw activity — no dead 'Question…' card, no JSON", () => {
        renderMessage(assistantMessage([questionToolPart()]));

        expect(screen.queryByText(/Question…/)).toBeNull();
        expect(screen.queryByText(/"questions"/)).toBeNull();
        expect(screen.queryByLabelText("Langy activity")).toBeNull();
      });

      it("renders while the turn is still streaming — the turn is waiting on this card", () => {
        renderMessage(assistantMessage([questionToolPart()]), {
          isStreaming: true,
        });

        expect(
          screen.getByText("Which agent should the scenario run against?"),
        ).toBeInTheDocument();
      });
    });

    describe("when the user picks an option", () => {
      it("answers through the choices path, bound to the tool call's own block id", () => {
        const onChoiceSelect = vi.fn();
        renderMessage(assistantMessage([questionToolPart()]), {
          onChoiceSelect,
        });

        fireEvent.click(screen.getByText("Staging agent"));

        expect(onChoiceSelect).toHaveBeenCalledTimes(1);
        const { selection, card } = onChoiceSelect.mock.calls[0]![0]!;
        expect(selection).toMatchObject({
          blockId: "question:call-q1:0",
          optionIds: ["opt-1"],
        });
        expect(card.question).toBe(
          "Which agent should the scenario run against?",
        );
      });
    });
  });

  describe("given the conversation already recorded the answer", () => {
    it("locks the card with the chosen option marked", () => {
      const message = assistantMessage([questionToolPart()]);
      const answer = {
        id: "m-user-answer",
        role: "user",
        parts: [
          {
            type: "langy-choice-selection",
            blockId: "question:call-q1:0",
            optionIds: ["opt-1"],
          },
          { type: "text", text: "Chose: Staging agent" },
        ],
      } as unknown as UIMessage;
      const onChoiceSelect = vi.fn();

      renderMessage(message, {
        choicesTimeline: langyChoicesTimeline([message, answer]),
        onChoiceSelect,
      });

      fireEvent.click(screen.getByText("Staging agent"));

      expect(onChoiceSelect).not.toHaveBeenCalled();
      expect(
        screen.getByText("Staging agent").closest("button"),
      ).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("given a question payload the choices contract cannot render", () => {
    it("stays on the raw activity path — broken input must never half-render", () => {
      renderMessage(
        assistantMessage([
          questionToolPart({ input: { questions: [{ header: "Agent" }] } }),
        ]),
      );

      expect(derivedFrames().length).toBe(0);
      // The honest fallback: the tool surfaces as ordinary activity.
      expect(screen.getByLabelText("Langy activity")).toBeInTheDocument();
    });
  });
});

describe("questionToolCardParts", () => {
  describe("given a multi-select question", () => {
    it("maps `multiple` onto the contract's multiSelect", () => {
      const [part] = questionToolCardParts(
        questionToolPart({
          input: {
            questions: [
              {
                question: "Which checks?",
                options: [{ label: "Faithfulness" }, { label: "Toxicity" }],
                multiple: true,
              },
            ],
          },
        }),
      );

      expect(part?.card).toMatchObject({ kind: "choices", multiSelect: true });
    });
  });

  describe("given the input is still streaming", () => {
    it("yields nothing — half a question is not a card", () => {
      expect(
        questionToolCardParts(questionToolPart({ state: "input-streaming" })),
      ).toEqual([]);
    });
  });

  describe("given only a header and no question text", () => {
    it("uses the header as the question rather than dropping the ask", () => {
      const [part] = questionToolCardParts(
        questionToolPart({
          input: {
            questions: [
              { header: "Agent", options: [{ label: "Staging agent" }] },
            ],
          },
        }),
      );

      expect(part?.card).toMatchObject({ question: "Agent" });
    });
  });
});
