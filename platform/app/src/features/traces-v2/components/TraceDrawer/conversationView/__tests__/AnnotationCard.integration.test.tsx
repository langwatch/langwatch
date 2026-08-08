/**
 * @vitest-environment jsdom
 *
 * What an annotation carries and how it reads beside its turn: the rating, the
 * scores and why they were given, who left it (including the ones that came in
 * over the API), and the correction it suggested. Only the author gets an edit
 * affordance. See specs/traces-v2/annotation-rail.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { AnnotationCard } from "../AnnotationCard";

const SCORE_NAMES = new Map([
  ["score-1", "Helpfulness"],
  ["score-retired", "Tone"],
]);

function annotation(over: Partial<AnnotationByTrace> = {}): AnnotationByTrace {
  return {
    id: "annotation-1",
    projectId: "project-1",
    traceId: "trace-1",
    comment: "the model invented a policy number",
    isThumbsUp: null,
    userId: "user-1",
    user: { id: "user-1", name: "Ada", image: null },
    email: null,
    scoreOptions: {},
    expectedOutput: null,
    createdAt: new Date("2026-08-01T10:30:00Z"),
    updatedAt: new Date("2026-08-01T10:30:00Z"),
    ...over,
  } as AnnotationByTrace;
}

function renderCard({
  item = annotation(),
  isOwn = false,
  onEdit = vi.fn(),
}: {
  item?: AnnotationByTrace;
  isOwn?: boolean;
  onEdit?: () => void;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationCard
        annotation={item}
        scoreNamesById={SCORE_NAMES}
        isOwn={isOwn}
        onEdit={onEdit}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given an annotation with a comment", () => {
  /** @scenario "An annotation shows its author, when it was written, and its comment" */
  it("shows the author, the time it was written, and the comment", () => {
    renderCard();

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(
      screen.getByText("the model invented a policy number"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new Date("2026-08-01T10:30:00Z").toLocaleString()),
    ).toBeInTheDocument();
  });
});

describe("given annotations rated with a thumb", () => {
  describe("when the turn was rated up", () => {
    /** @scenario "A rating shows the thumb it was given" */
    it("shows the thumbs-up it was given", () => {
      renderCard({ item: annotation({ isThumbsUp: true }) });

      expect(screen.getByLabelText("Thumbs up")).toBeInTheDocument();
      expect(screen.queryByLabelText("Thumbs down")).not.toBeInTheDocument();
    });
  });

  describe("when the turn was rated down", () => {
    /** @scenario "A rating shows the thumb it was given" */
    it("shows the thumbs-down it was given", () => {
      renderCard({ item: annotation({ isThumbsUp: false }) });

      expect(screen.getByLabelText("Thumbs down")).toBeInTheDocument();
      expect(screen.queryByLabelText("Thumbs up")).not.toBeInTheDocument();
    });
  });

  describe("when the turn was not rated", () => {
    /** @scenario "A rating shows the thumb it was given" */
    it("shows neither thumb", () => {
      renderCard({ item: annotation({ isThumbsUp: null }) });

      expect(screen.queryByLabelText("Thumbs up")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Thumbs down")).not.toBeInTheDocument();
    });
  });
});

describe("given an annotation carrying scores", () => {
  /** @scenario "Scores show their name, their value, and the reason behind them" */
  it("names the score, shows its value, and offers the reason", () => {
    renderCard({
      item: annotation({
        scoreOptions: {
          "score-1": { value: "good", reason: "answered the actual question" },
        },
      }),
    });

    expect(screen.getByText("Helpfulness")).toBeInTheDocument();
    expect(screen.getByText("good")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason for Helpfulness")).toBeInTheDocument();
  });

  it("leaves a score with no reason without a reason affordance", () => {
    renderCard({
      item: annotation({ scoreOptions: { "score-1": { value: "good" } } }),
    });

    expect(
      screen.queryByLabelText("Reason for Helpfulness"),
    ).not.toBeInTheDocument();
  });

  it("joins a multi-value score into one readable value", () => {
    renderCard({
      item: annotation({
        scoreOptions: { "score-1": { value: ["concise", "correct"] } },
      }),
    });

    expect(screen.getByText("concise, correct")).toBeInTheDocument();
  });

  /** @scenario "A score left on a key that was since deactivated still reads by name" */
  it("still names a score whose key is no longer active", () => {
    renderCard({
      item: annotation({
        scoreOptions: { "score-retired": { value: "warm" } },
      }),
    });

    expect(screen.getByText("Tone")).toBeInTheDocument();
    expect(screen.getByText("warm")).toBeInTheDocument();
  });

  it("drops a score the project has no name for rather than showing its id", () => {
    renderCard({
      item: annotation({
        scoreOptions: { "score-deleted": { value: "warm" } },
      }),
    });

    expect(screen.queryByText("score-deleted")).not.toBeInTheDocument();
    expect(screen.queryByText("warm")).not.toBeInTheDocument();
  });
});

describe("given an annotation with no LangWatch user behind it", () => {
  describe("when it carried an email", () => {
    /** @scenario "An annotation left through the API is labelled as such" */
    it("marks it as coming from the API and shows the email", () => {
      renderCard({
        item: annotation({
          user: null,
          userId: null,
          email: "reviewer@acme.test",
        }),
      });

      expect(screen.getByText("API")).toBeInTheDocument();
      expect(screen.getByText("reviewer@acme.test")).toBeInTheDocument();
    });
  });

  describe("when it carried no email", () => {
    /** @scenario "An annotation left through the API is labelled as such" */
    it("reads as anonymous", () => {
      renderCard({ item: annotation({ user: null, userId: null }) });

      expect(screen.getByText("API")).toBeInTheDocument();
      expect(screen.getByText("anonymous")).toBeInTheDocument();
    });
  });
});

describe("given an annotation with a suggested output", () => {
  /** @scenario "A suggested correction is shown as a correction" */
  it("shows the suggestion and marks it as a correction", () => {
    renderCard({
      item: annotation({ expectedOutput: "Policy 4471 covers water damage." }),
    });

    expect(screen.getByText("correction")).toBeInTheDocument();
    expect(
      screen.getByText("Policy 4471 covers water damage."),
    ).toBeInTheDocument();
  });
});

describe("given an annotation somebody else wrote", () => {
  /** @scenario "Another reviewer's annotation is read-only" */
  it("offers no edit affordance", () => {
    renderCard({ isOwn: false });

    expect(screen.queryByLabelText("Edit annotation")).not.toBeInTheDocument();
  });

  describe("when the reader clicks it", () => {
    it("does not open a composer", () => {
      const onEdit = vi.fn();
      const { container } = renderCard({ isOwn: false, onEdit });

      fireEvent.click(container.firstElementChild!);

      expect(onEdit).not.toHaveBeenCalled();
    });
  });
});

describe("given an annotation the reviewer wrote", () => {
  /** @scenario "The reviewer's own annotation offers to be edited" */
  it("offers an edit affordance", () => {
    renderCard({ isOwn: true });

    expect(screen.getByLabelText("Edit annotation")).toBeInTheDocument();
  });

  describe("when the reviewer clicks it", () => {
    it("opens the composer on that annotation", () => {
      const onEdit = vi.fn();
      renderCard({ isOwn: true, onEdit });

      fireEvent.click(screen.getByLabelText("Edit annotation"));

      expect(onEdit).toHaveBeenCalled();
    });
  });

  describe("when the reviewer reaches it with the keyboard", () => {
    /** @scenario "An annotation is opened from the keyboard the way it is from the mouse" */
    it.each(["Enter", " "])("opens the composer on %s", (key) => {
      const onEdit = vi.fn();
      renderCard({ isOwn: true, onEdit });

      fireEvent.keyDown(screen.getByLabelText("Edit annotation"), { key });

      expect(onEdit).toHaveBeenCalled();
    });

    it("ignores keys that do not activate a button", () => {
      const onEdit = vi.fn();
      renderCard({ isOwn: true, onEdit });

      fireEvent.keyDown(screen.getByLabelText("Edit annotation"), {
        key: "ArrowDown",
      });

      expect(onEdit).not.toHaveBeenCalled();
    });
  });
});

describe("given an annotation somebody else wrote, reached with the keyboard", () => {
  /** @scenario "An annotation is opened from the keyboard the way it is from the mouse" */
  it("stays closed on Enter", () => {
    const onEdit = vi.fn();
    const { container } = renderCard({ isOwn: false, onEdit });

    fireEvent.keyDown(container.firstElementChild!, { key: "Enter" });

    expect(onEdit).not.toHaveBeenCalled();
  });
});
