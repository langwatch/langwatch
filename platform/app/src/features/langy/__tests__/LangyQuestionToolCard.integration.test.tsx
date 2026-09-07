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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
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
    useUtils: () => ({}),
  },
}));

import { MessageContent } from "../components/MessageContent";
import { langyChoicesTimeline } from "../logic/langyChoicesTimeline";
import { questionToolCardParts } from "../logic/langyQuestionTool";

afterEach(cleanup);

/** The choices cards on screen. A question is an ask, so it wears no derived frame. */
const choicesCards = () =>
  document.querySelectorAll("[data-langy-choices-card]");

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
      /** @scenario "A question is an ask, not a view Langy composed" */
      it("draws the interactive choices card, titled by the question itself, without the derived frame", () => {
        renderMessage(assistantMessage([questionToolPart()]));

        expect(choicesCards().length).toBe(1);
        expect(
          screen.getByText("Which agent should the scenario run against?"),
        ).toBeInTheDocument();
        expect(screen.getByText("Staging agent")).toBeInTheDocument();
        expect(screen.getByText("The safe one")).toBeInTheDocument();
        expect(screen.getByText("Production agent")).toBeInTheDocument();
        // The dashed provenance chrome is for the cards Langy composed from
        // the project's data; a question is not one.
        expect(document.querySelector("[data-derived-by-langy]")).toBeNull();
        expect(screen.queryByText("Made by Langy")).toBeNull();
      });

      /** @scenario "A bare question draws its words as prose above the options" */
      it("draws the question as reply prose, not a title, when the question is bare", () => {
        const proposal =
          "Now that your agent is integrated, I think we should write some tests for it. The first one I'd write is **Guest completes checkout**, because it is the golden path.";
        renderMessage(
          assistantMessage([
            questionToolPart({
              input: {
                questions: [
                  {
                    question: proposal,
                    bare: true,
                    options: [
                      {
                        label:
                          'Create "Guest completes checkout" as your first scenario test',
                      },
                      { label: "Chat about this", quiet: true },
                    ],
                  },
                ],
              },
            }),
          ]),
        );

        const card = choicesCards()[0]!;
        expect(choicesCards().length).toBe(1);
        expect(card.getAttribute("data-choices-bare")).toBe("true");

        // The words render as markdown prose inside the card, above the
        // options, with no title element carrying them.
        const prose = card.querySelector("[data-langy-choices-prose]");
        expect(prose).not.toBeNull();
        expect(prose!.textContent).toContain(
          "Now that your agent is integrated, I think we should write some tests for it.",
        );
        expect(prose!.querySelector("strong")?.textContent).toBe(
          "Guest completes checkout",
        );
        const options = card.querySelectorAll(
          "[data-testid='langy-choice-option']",
        );
        expect(options.length).toBe(2);
        expect(
          prose!.compareDocumentPosition(options[0]!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        // The prose is no part of what a button is called.
        expect(
          screen.getByRole("button", {
            name: 'Create "Guest completes checkout" as your first scenario test',
          }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Chat about this" }),
        ).toBeInTheDocument();
      });

      it("keeps the title for a question that is not bare", () => {
        renderMessage(assistantMessage([questionToolPart()]));

        const card = choicesCards()[0]!;
        expect(card.querySelector("[data-langy-choices-prose]")).toBeNull();
        expect(card.getAttribute("data-choices-bare")).toBeNull();
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

  describe("given the answer went back to the tool's wait", () => {
    /** @scenario "A settled question reads settled, with the option that was chosen" */
    it("locks the card on the option the wait names, with nothing left to click", () => {
      // The wait is the only record of this answer: answering a mid-turn
      // question returns it to the waiting tool and writes no selection into
      // the transcript, so the timeline alone reads the card as never
      // answered and offers it again after the turn.
      const message = assistantMessage([questionToolPart()]);
      const onChoiceSelect = vi.fn();

      renderMessage(message, {
        onChoiceSelect,
        questionWaits: new Map([
          [
            "call-q1",
            {
              waitId: "lwait_1",
              toolCallId: "call-q1",
              status: "answered" as const,
              questions: null,
              answers: [
                {
                  question: "Which agent should the scenario run against?",
                  selected: ["Staging agent"],
                },
              ],
            },
          ],
        ]),
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

      expect(choicesCards().length).toBe(0);
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
