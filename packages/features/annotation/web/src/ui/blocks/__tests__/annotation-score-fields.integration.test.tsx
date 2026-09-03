/**
 * @vitest-environment jsdom
 *
 * Rating a turn on the project's score keys. The chip opens a small form: what
 * the reviewer picks and types stays in it until they confirm, so a rating and
 * the reason behind it land together and leaving the form any other way costs
 * them nothing. See specs/traces-v2/annotations.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ScoreFields } from "../annotation-score-fields";
import type { AnnotationScore } from "@langwatch/annotation-contract";
import type { ScoreOptions } from "@langwatch/annotation-contract";
import type {
  AnnotationFormState,
  AnnotationScoreList,
} from "../../../model/annotation-form-types";

function score(over: Partial<AnnotationScore>): AnnotationScore {
  return {
    id: "score-1",
    projectId: "project-1",
    name: "Helpfulness",
    createdAt: new Date("2026-08-25T08:00:00.000Z"),
    updatedAt: new Date("2026-08-25T08:00:00.000Z"),
    deletedAt: null,
    description: "How much the answer helped",
    active: true,
    dataType: "LIKERT",
    options: [
      { label: "Unhelpful", value: "unhelpful" },
      { label: "Helpful", value: "helpful" },
    ],
    defaultValue: null,
    global: false,
    ...over,
  };
}

const SINGLE_CHOICE_SCORE = score({});
const MULTIPLE_CHOICE_SCORE = score({
  id: "score-2",
  name: "Traits",
  description: null,
  dataType: "CHECKBOX",
  options: [
    { label: "Concise", value: "concise" },
    { label: "Correct", value: "correct" },
  ],
});

/** What the form holds while the reviewer is composing, read by the assertions. */
const composed: { scoreOptions: ScoreOptions } = { scoreOptions: {} };

function makeState(over: Partial<AnnotationFormState>): AnnotationFormState {
  return {
    comment: "",
    setComment: vi.fn(),
    expectedOutput: "",
    setExpectedOutput: vi.fn(),
    scoreOptions: {},
    setScoreOptions: vi.fn(),
    scores: { data: [], isLoading: false },
    anchorLabel: null,
    suggestTarget: "output",
    isEdit: false,
    isSaving: false,
    isDeleting: false,
    hasExisting: false,
    isSaveBlocked: false,
    handleSave: vi.fn(),
    handleDelete: vi.fn(),
    onCancel: vi.fn(),
    mode: "annotate",
    ...over,
  };
}

function ScoreFieldsHost({
  scores,
  initial,
}: {
  scores: AnnotationScoreList;
  initial: ScoreOptions;
}) {
  const [scoreOptions, setScoreOptions] = useState<ScoreOptions>(initial);
  composed.scoreOptions = scoreOptions;
  return (
    <ScoreFields
      state={makeState({
        scoreOptions,
        setScoreOptions,
        scores: { data: scores, isLoading: false },
      })}
    />
  );
}

function renderScores({
  scores = [SINGLE_CHOICE_SCORE],
  initial = {},
}: {
  scores?: AnnotationScoreList;
  initial?: ScoreOptions;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ScoreFieldsHost scores={scores} initial={initial} />
    </ChakraProvider>,
  );
}

const chip = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  composed.scoreOptions = {};
});

afterEach(cleanup);

describe("given a score key the reviewer opened", () => {
  describe("when they pick one of its options", () => {
    /** @scenario "Picking a rating keeps the editor open until it is confirmed" */
    it("keeps the editor open with that option selected", async () => {
      renderScores();
      await userEvent.click(chip("Helpfulness"));

      await userEvent.click(await screen.findByRole("radio", { name: "Helpful" }));

      expect(screen.getByRole("radio", { name: "Helpful" })).toBeChecked();
      expect(screen.getByRole("button", { name: "OK" })).toBeVisible();
    });

    /** @scenario "Picking a rating keeps the editor open until it is confirmed" */
    it("leaves the chip unrated until the pick is confirmed", async () => {
      renderScores();
      await userEvent.click(chip("Helpfulness"));

      await userEvent.click(await screen.findByRole("radio", { name: "Helpful" }));

      expect(chip("Helpfulness")).toHaveTextContent(/^Helpfulness$/);
      expect(composed.scoreOptions["score-1"]).toBeUndefined();
    });
  });

  describe("when they type a reason and confirm", () => {
    /** @scenario "Confirming keeps the rating and the reason given with it" */
    /** @scenario "reusable annotation browser surfaces stay in the feature web package" */
    it("closes the editor and keeps the rating with its reason", async () => {
      renderScores();
      await userEvent.click(chip("Helpfulness"));
      await userEvent.click(await screen.findByRole("radio", { name: "Helpful" }));
      await userEvent.type(
        screen.getByPlaceholderText("Reason (optional)"),
        "answered the actual question",
      );

      await userEvent.click(screen.getByRole("button", { name: "OK" }));

      await waitFor(() =>
        expect(screen.queryByRole("radio", { name: "Helpful" })).not.toBeInTheDocument(),
      );
      expect(composed.scoreOptions["score-1"]).toEqual({
        value: "helpful",
        reason: "answered the actual question",
      });
    });

    /** @scenario "Confirming keeps the rating and the reason given with it" */
    it("reads the rating on the chip and says it carries a reason", async () => {
      renderScores();
      await userEvent.click(chip("Helpfulness"));
      await userEvent.click(await screen.findByRole("radio", { name: "Helpful" }));
      await userEvent.type(
        screen.getByPlaceholderText("Reason (optional)"),
        "answered the actual question",
      );
      await userEvent.click(screen.getByRole("button", { name: "OK" }));

      expect(chip(/Helpfulness/)).toHaveTextContent("Helpfulness: helpful");
      expect(screen.getByLabelText("Helpfulness has a reason")).toBeInTheDocument();
    });
  });

  describe("when they close the editor without confirming", () => {
    /** @scenario "Leaving the editor any other way keeps the rating it had" */
    it("keeps the rating the score already had on an outside click", async () => {
      renderScores({
        initial: { "score-1": { value: "unhelpful", reason: "" } },
      });
      await userEvent.click(chip(/Helpfulness/));
      await userEvent.click(await screen.findByRole("radio", { name: "Helpful" }));

      await userEvent.click(document.body);

      expect(chip(/Helpfulness/)).toHaveTextContent("Helpfulness: unhelpful");
      expect(composed.scoreOptions["score-1"]).toEqual({
        value: "unhelpful",
        reason: "",
      });
    });

    /** @scenario "Leaving the editor any other way keeps the rating it had" */
    it("leaves an unrated score unrated on Escape", async () => {
      renderScores();
      await userEvent.click(chip("Helpfulness"));
      await userEvent.click(await screen.findByRole("radio", { name: "Helpful" }));

      await userEvent.keyboard("{Escape}");

      expect(chip("Helpfulness")).toHaveTextContent(/^Helpfulness$/);
      expect(composed.scoreOptions["score-1"]).toBeUndefined();
    });

    /** @scenario "Leaving the editor any other way keeps the rating it had" */
    it("starts from the committed rating when the editor is opened again", async () => {
      renderScores({
        initial: { "score-1": { value: "unhelpful", reason: "" } },
      });
      await userEvent.click(chip(/Helpfulness/));
      await userEvent.click(await screen.findByRole("radio", { name: "Helpful" }));
      await userEvent.keyboard("{Escape}");

      await userEvent.click(chip(/Helpfulness/));

      expect(await screen.findByRole("radio", { name: "Unhelpful" })).toBeChecked();
      expect(screen.getByRole("radio", { name: "Helpful" })).not.toBeChecked();
    });
  });
});

describe("given a score the reviewer already rated", () => {
  describe("when they clear it", () => {
    /** @scenario "Clearing a score returns it to unrated" */
    it("returns the chip to unrated, carrying neither rating nor reason", async () => {
      renderScores({
        initial: {
          "score-1": { value: "helpful", reason: "answered the question" },
        },
      });
      await userEvent.click(chip(/Helpfulness/));

      await userEvent.click(await screen.findByRole("button", { name: "Clear" }));

      expect(chip("Helpfulness")).toHaveTextContent(/^Helpfulness$/);
      expect(screen.queryByLabelText("Helpfulness has a reason")).not.toBeInTheDocument();
      expect(composed.scoreOptions["score-1"]).toEqual({
        value: "",
        reason: "",
      });
    });
  });
});

describe("given a score key whose options are multiple-choice", () => {
  describe("when the reviewer ticks two of them and confirms", () => {
    /** @scenario "A multiple-choice score takes several options at once" */
    it("keeps both options on the score", async () => {
      renderScores({ scores: [MULTIPLE_CHOICE_SCORE] });
      await userEvent.click(chip("Traits"));

      await userEvent.click(await screen.findByRole("checkbox", { name: "Concise" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Correct" }));
      await userEvent.click(screen.getByRole("button", { name: "OK" }));

      expect(composed.scoreOptions["score-2"]).toEqual({
        value: ["concise", "correct"],
        reason: "",
      });
    });

    /** @scenario "A multiple-choice score takes several options at once" */
    it("reads on the chip as carrying both", async () => {
      renderScores({ scores: [MULTIPLE_CHOICE_SCORE] });
      await userEvent.click(chip("Traits"));
      await userEvent.click(await screen.findByRole("checkbox", { name: "Concise" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Correct" }));
      await userEvent.click(screen.getByRole("button", { name: "OK" }));

      expect(chip(/Traits/)).toHaveTextContent("Traits: 2 selected");
    });
  });
});
