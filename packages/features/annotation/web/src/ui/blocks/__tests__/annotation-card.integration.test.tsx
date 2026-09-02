// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationCard, type AnnotationWithUser } from "../../../index";

const SCORE_NAMES = new Map([
  ["score-1", "Helpfulness"],
  ["score-retired", "Tone"],
]);

function annotation(over: Partial<AnnotationWithUser> = {}): AnnotationWithUser {
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
    anchorKind: null,
    anchorId: null,
    anchorPath: null,
    createdAt: "2026-08-01T10:30:00Z",
    updatedAt: "2026-08-01T10:30:00Z",
    ...over,
  };
}

function renderCard({
  item = annotation(),
  isOwn = false,
  contextTraceId,
  onEdit = vi.fn(),
  openTraceId = null,
  onJumpToAnchor = vi.fn(),
}: {
  item?: AnnotationWithUser;
  isOwn?: boolean;
  contextTraceId?: string;
  onEdit?: () => void;
  openTraceId?: string | null;
  onJumpToAnchor?: (target: {
    traceId: string;
    anchorKind: string | null;
    anchorId: string | null;
    anchorPath: string | null;
  }) => void;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationCard
        annotation={item}
        scoreNamesById={SCORE_NAMES}
        contextTraceId={contextTraceId}
        isOwn={isOwn}
        onEdit={onEdit}
        openTraceId={openTraceId}
        onJumpToAnchor={onJumpToAnchor}
        renderAvatar={(user) => <span data-testid="annotation-avatar">{user.name ?? "?"}</span>}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("annotation card presentation", () => {
  it("shows the author, timestamp, comment, and rating", () => {
    renderCard({ item: annotation({ isThumbsUp: true }) });

    expect(screen.getByTestId("annotation-avatar")).toHaveTextContent("Ada");
    expect(screen.getByText("the model invented a policy number")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-08-01T10:30:00Z").toLocaleString())).toBeInTheDocument();
    expect(screen.getByLabelText("Thumbs up")).toBeInTheDocument();
  });

  it("shows a down rating and no up rating", () => {
    renderCard({ item: annotation({ isThumbsUp: false }) });

    expect(screen.getByLabelText("Thumbs down")).toBeInTheDocument();
    expect(screen.queryByLabelText("Thumbs up")).not.toBeInTheDocument();
  });

  it("shows score names, values, reasons, and suggested output", () => {
    renderCard({
      item: annotation({
        scoreOptions: {
          "score-1": { value: ["good", "concise"], reason: "answered the question" },
        },
        expectedOutput: "Policy 4471 covers water damage.",
      }),
    });

    expect(screen.getByText("Helpfulness")).toBeInTheDocument();
    expect(screen.getByText("good, concise")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason for Helpfulness")).toBeInTheDocument();
    expect(screen.getByText("correction")).toBeInTheDocument();
    expect(screen.getByText("Policy 4471 covers water damage.")).toBeInTheDocument();
  });

  it("keeps retired score names and drops unknown score ids", () => {
    renderCard({
      item: annotation({
        scoreOptions: {
          "score-retired": { value: "warm" },
          "score-deleted": { value: "gone" },
        },
      }),
    });

    expect(screen.getByText("Tone")).toBeInTheDocument();
    expect(screen.getByText("warm")).toBeInTheDocument();
    expect(screen.queryByText("score-deleted")).not.toBeInTheDocument();
    expect(screen.queryByText("gone")).not.toBeInTheDocument();
  });

  it("labels API annotations with the carried identity", () => {
    renderCard({
      item: annotation({ user: null, userId: null, email: "reviewer@acme.test" }),
    });

    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getAllByText("reviewer@acme.test")).toHaveLength(2);
  });
});

describe("annotation card anchors", () => {
  it("names a span field and jumps to it when the trace is open", () => {
    const onJumpToAnchor = vi.fn();
    renderCard({
      openTraceId: "trace-1",
      onJumpToAnchor,
      item: annotation({ anchorKind: "field", anchorId: "span-7", anchorPath: "output" }),
    });

    expect(screen.getByTestId("annotation-anchor")).toHaveTextContent("Go to Span span-7 · Output");
    fireEvent.click(screen.getByTestId("annotation-anchor"));

    expect(onJumpToAnchor).toHaveBeenCalledWith({
      traceId: "trace-1",
      anchorKind: "field",
      anchorId: "span-7",
      anchorPath: "output",
    });
  });

  it("names a trace field without repeating the trace in its own context", () => {
    renderCard({
      openTraceId: "trace-1",
      contextTraceId: "trace-1",
      item: annotation({
        anchorKind: "field",
        anchorId: "trace-1",
        anchorPath: "metadata.environment",
      }),
    });

    expect(screen.getByTestId("annotation-anchor")).toHaveTextContent(
      "Go to Metadata · environment",
    );
  });

  it("renders an anchor as read-only when another trace is open", () => {
    renderCard({
      openTraceId: "trace-2",
      item: annotation({ anchorKind: "span", anchorId: "span-9" }),
    });

    expect(screen.getByTestId("annotation-anchor")).not.toHaveAttribute("type", "button");
    expect(screen.getByTestId("annotation-anchor")).toHaveTextContent("Span span-9");
  });

  it("does not name a whole-trace annotation or a message id", () => {
    renderCard();
    expect(screen.queryByTestId("annotation-anchor")).not.toBeInTheDocument();

    cleanup();
    renderCard({
      item: annotation({
        anchorKind: "message",
        anchorId: "trace-1",
        anchorPath: "message-1",
      }),
    });
    expect(screen.getByTestId("annotation-anchor")).toHaveTextContent("Message");
    expect(screen.getByTestId("annotation-anchor")).not.toHaveTextContent("message-1");
  });
});

describe("annotation card editing", () => {
  it("only lets its author edit with click or keyboard", () => {
    const onEdit = vi.fn();
    renderCard({ isOwn: true, onEdit });

    expect(screen.getByLabelText("Edit annotation")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Edit annotation"), { key: "Enter" });
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("keeps another reviewer's card read-only", () => {
    const onEdit = vi.fn();
    const { container } = renderCard({ isOwn: false, onEdit });

    expect(screen.queryByLabelText("Edit annotation")).not.toBeInTheDocument();
    fireEvent.click(container.firstElementChild!);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
