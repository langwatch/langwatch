/**
 * @vitest-environment jsdom
 *
 * The rail beside a conversation turn: when it exists, where it sits, how it
 * starts an annotation, and why what is typed in it outlives the turn being
 * unmounted by the virtualizer. See specs/traces-v2/annotation-rail.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type MutationOptions = { onSuccess?: () => void; onError?: () => void };

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  invalidateAnnotations: vi.fn(),
  invalidateAnnotationFeed: vi.fn(),
  invalidateOverlay: vi.fn(),
  storedAnnotations: [] as unknown[],
  activeScores: [] as unknown[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: {},
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      annotation: {
        getByTraceId: { invalidate: mocks.invalidateAnnotations },
        getByTraceIds: { invalidate: mocks.invalidateAnnotationFeed },
      },
      traceEditOverlay: {
        getByTraceId: { invalidate: mocks.invalidateOverlay },
      },
    }),
    annotation: {
      getByTraceId: { useQuery: () => ({ data: mocks.storedAnnotations }) },
      create: {
        useMutation: () => ({ mutate: mocks.create, isLoading: false }),
      },
      updateByTraceId: {
        useMutation: () => ({ mutate: mocks.update, isLoading: false }),
      },
      deleteById: {
        useMutation: () => ({ mutate: mocks.remove, isLoading: false }),
      },
    },
    annotationScore: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "score-1", name: "Helpfulness" }],
          isLoading: false,
        }),
      },
      getAllActive: {
        useQuery: () => ({ data: mocks.activeScores, isLoading: false }),
      },
    },
  },
}));

/**
 * The turn itself is covered by its own tests; here it only has to be
 * something the rail can sit beside, and to report what the rail layout asked
 * of it.
 */
vi.mock("../ChatTurnRow", () => ({
  ChatTurnRow: ({
    turn,
    shouldUseRailComposer,
    annotationItems,
  }: {
    turn: { traceId: string };
    shouldUseRailComposer?: boolean;
    annotationItems?: unknown[];
  }) => (
    <div
      data-testid="chat-turn-row"
      data-uses-rail-composer={String(!!shouldUseRailComposer)}
      // What the turn itself counts, which is what its badge reads.
      data-annotation-count={String(annotationItems?.length ?? 0)}
    >
      {turn.traceId}
    </div>
  ),
}));

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useAnnotationDraftStore } from "../../../../stores/annotationDraftStore";
import { NO_TRACE_EVENTS, type TraceListItem } from "../../../../types/trace";
import { AnnotatedTurnRow } from "../AnnotatedTurnRow";
import { TurnActionRow } from "../TurnAnnotations";
import type { ParsedTurn } from "../types";
import {
  RAIL_WIDTH_SLIM_PX,
  RAIL_WIDTH_WIDE_PX,
  type RailLayout,
} from "../useRailLayout";

const TRACE_ID = "trace-1";
const SIDE_LAYOUT: RailLayout = {
  mode: "side",
  railWidth: RAIL_WIDTH_WIDE_PX,
};
const STACKED_LAYOUT: RailLayout = {
  mode: "stacked",
  railWidth: RAIL_WIDTH_SLIM_PX,
};

function turn(): TraceListItem {
  return {
    traceId: TRACE_ID,
    timestamp: 1,
    name: "turn",
    serviceName: "svc",
    durationMs: 10,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    sizeBytes: 0,
    input: null,
    output: "the original answer",
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
  };
}

function parsedTurn(): ParsedTurn {
  return {
    turn: turn(),
    userText: "a question",
    assistantText: "the original answer",
    assistantReasoning: "",
    userMedia: [],
    assistantMedia: [],
    gapSecs: 0,
    showGap: false,
  };
}

function annotation(over: Partial<AnnotationByTrace> = {}): AnnotationByTrace {
  return {
    id: "annotation-1",
    projectId: "project-1",
    traceId: TRACE_ID,
    comment: "the model invented a policy number",
    isThumbsUp: null,
    userId: "user-2",
    user: { id: "user-2", name: "Grace", image: null },
    email: null,
    scoreOptions: {},
    expectedOutput: null,
    createdAt: new Date("2026-08-01T10:30:00Z"),
    updatedAt: new Date("2026-08-01T10:30:00Z"),
    ...over,
  } as AnnotationByTrace;
}

function renderRow({
  isRailActive = true,
  railLayout = SIDE_LAYOUT,
  annotations = [] as AnnotationByTrace[],
  anchoredAnnotations = [] as AnnotationByTrace[],
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotatedTurnRow
        parsed={parsedTurn()}
        index={1}
        layout="thread"
        isCurrent={false}
        onSelectTurn={vi.fn()}
        annotations={annotations}
        anchoredAnnotations={anchoredAnnotations}
        isRailActive={isRailActive}
        railLayout={railLayout}
      />
    </ChakraProvider>,
  );
}

const rail = () => screen.getByTestId(`turn-annotation-rail-${TRACE_ID}`);
const draft = () => useAnnotationDraftStore.getState().draft;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storedAnnotations = [];
  mocks.activeScores = [];
  useAnnotationDraftStore.setState({ draft: null });
  cleanup();
});

describe("given the conversation has no rail", () => {
  /** @scenario "A turn renders unchanged while the rail is closed" */
  it("renders the turn as the only column", () => {
    renderRow({ isRailActive: false });

    expect(screen.getByTestId("chat-turn-row")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`turn-annotation-rail-${TRACE_ID}`),
    ).not.toBeInTheDocument();
  });
});

describe("given the rail is open beside a turn", () => {
  /** @scenario "The rail sits to the right of the turn it belongs to" */
  it("renders the turn before its rail", () => {
    renderRow();

    const position = screen
      .getByTestId("chat-turn-row")
      .compareDocumentPosition(rail());

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("routes the turn's annotate actions to the rail composer", () => {
    renderRow();

    expect(screen.getByTestId("chat-turn-row")).toHaveAttribute(
      "data-uses-rail-composer",
      "true",
    );
  });

  describe("when the reviewer clicks the empty rail beside the turn", () => {
    /** @scenario "Clicking the empty rail beside a turn starts an annotation on it" */
    it("opens a composer for that turn", () => {
      renderRow();

      fireEvent.click(rail());

      expect(draft()).toMatchObject({ traceId: TRACE_ID, mode: "annotate" });
      expect(screen.getByLabelText("Annotation composer")).toBeInTheDocument();
    });
  });

  describe("when the reviewer uses the rail's add affordance", () => {
    it("opens a composer for that turn", () => {
      renderRow();

      fireEvent.click(screen.getByRole("button", { name: /Add annotation/ }));

      expect(draft()).toMatchObject({ traceId: TRACE_ID, mode: "annotate" });
    });
  });

  describe("when the reviewer clicks an annotation somebody else wrote", () => {
    /** @scenario "Clicking an annotation does not start a second one" */
    it("opens no composer", () => {
      renderRow({ annotations: [annotation()] });

      fireEvent.click(screen.getByText("the model invented a policy number"));

      expect(draft()).toBeNull();
      expect(
        screen.queryByLabelText("Annotation composer"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("given a turn in thread layout, where the rail lives", () => {
  describe("when the reviewer uses the turn's annotate action", () => {
    /** @scenario "The turn's own annotate action writes in the rail" */
    it("opens the composer in the rail rather than over the conversation", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <TurnActionRow
            traceId={TRACE_ID}
            output="the original answer"
            shouldUseRailComposer
          />
        </ChakraProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
      await vi.waitFor(() =>
        expect(draft()).toMatchObject({
          traceId: TRACE_ID,
          mode: "annotate",
        }),
      );

      expect(screen.queryByPlaceholderText("Optional")).not.toBeInTheDocument();
    });

    it("starts a suggestion from the turn's output", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <TurnActionRow
            traceId={TRACE_ID}
            output="the original answer"
            shouldUseRailComposer
          />
        </ChakraProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Suggest" }));

      await vi.waitFor(() =>
        expect(draft()).toMatchObject({
          mode: "suggest",
          expectedOutput: "the original answer",
        }),
      );
    });
  });
});

describe("given a pane too narrow for two columns", () => {
  /** @scenario "A stacked rail is indented to line up with the message text" */
  it("renders the rail under the turn, inset to the message text", () => {
    renderRow({ railLayout: STACKED_LAYOUT });

    const inset = rail().parentElement!;
    expect(inset).toHaveStyle({ paddingLeft: "34px" });

    const position = screen
      .getByTestId("chat-turn-row")
      .compareDocumentPosition(rail());
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("given the reviewer has typed a comment in the rail composer", () => {
  describe("when the turn is unmounted and rendered again", () => {
    /** @scenario "Typed text survives the turn scrolling out of view" */
    it("still holds the typed comment", () => {
      const first = renderRow();
      fireEvent.click(rail());
      fireEvent.change(screen.getByPlaceholderText("Optional"), {
        target: { value: "half a thought" },
      });

      first.unmount();
      renderRow();

      expect(screen.getByPlaceholderText("Optional")).toHaveValue(
        "half a thought",
      );
    });
  });
});

describe("given the reviewer has written an annotation in the rail composer", () => {
  describe("when they save it", () => {
    /** @scenario "Saving from the rail refreshes the conversation's annotation feed" */
    it("refreshes the batched annotation feed and closes the composer", () => {
      renderRow();
      fireEvent.click(rail());
      fireEvent.change(screen.getByPlaceholderText("Optional"), {
        target: { value: "invented a policy number" },
      });

      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      const options = (mocks.create as Mock).mock.calls[0]?.[1] as
        | MutationOptions
        | undefined;
      options?.onSuccess?.();

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: TRACE_ID,
          comment: "invented a policy number",
        }),
        expect.anything(),
      );
      expect(mocks.invalidateAnnotationFeed).toHaveBeenCalled();
      expect(draft()).toBeNull();
    });
  });

  describe("when they cancel it", () => {
    it("closes the composer without writing anything", () => {
      renderRow();
      fireEvent.click(rail());

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mocks.create).not.toHaveBeenCalled();
      expect(draft()).toBeNull();
    });
  });
});

describe("given the turn carries an annotation the reviewer wrote", () => {
  const own = annotation({
    userId: "user-1",
    user: { id: "user-1", name: "Ada", image: null },
    comment: "the model invented a policy number",
  });

  beforeEach(() => {
    mocks.storedAnnotations = [own];
  });

  describe("when the reviewer edits it", () => {
    /** @scenario "Editing an annotation opens the composer where the annotation sits" */
    it("opens the composer in its place, carrying its comment", () => {
      renderRow({ annotations: [own] });

      fireEvent.click(screen.getByLabelText("Edit annotation"));

      expect(draft()).toMatchObject({
        traceId: TRACE_ID,
        annotationId: "annotation-1",
      });
      expect(screen.getByPlaceholderText("Optional")).toHaveValue(
        "the model invented a policy number",
      );
    });

    /** @scenario "Editing an annotation opens the composer where the annotation sits" */
    it("offers to delete the annotation", () => {
      renderRow({ annotations: [own] });

      fireEvent.click(screen.getByLabelText("Edit annotation"));

      expect(
        screen.getByRole("button", { name: "Delete annotation" }),
      ).toBeInTheDocument();
    });
  });
});

/**
 * A turn's rail holds what was said about the turn and what was said about the
 * parts inside it, and only the first of the two is what the turn counts.
 * See specs/traces-v2/anchored-comments.feature.
 */
describe("given a turn commented on as a whole and on two of its spans", () => {
  const onTheTurn = annotation({
    id: "annotation-on-turn",
    comment: "the answer contradicts the policy",
  });
  const onASpan = annotation({
    id: "annotation-on-span",
    comment: "this search returned nothing",
    anchorKind: "span",
    anchorId: "span-7",
  });
  const onAnotherSpan = annotation({
    id: "annotation-on-another-span",
    comment: "and this one timed out",
    anchorKind: "span",
    anchorId: "span-9",
  });

  const renderCommentedTurn = () =>
    renderRow({
      annotations: [onTheTurn],
      anchoredAnnotations: [onASpan, onAnotherSpan],
    });

  /** @scenario "A commented part of a turn reads beside that turn" */
  it("lists the comments on its parts in the rail beside it", () => {
    renderCommentedTurn();

    expect(
      screen.getByText("this search returned nothing"),
    ).toBeInTheDocument();
    expect(screen.getByText("and this one timed out")).toBeInTheDocument();
  });

  /** @scenario "A commented part of a turn reads beside that turn" */
  it("names the span each of them is about", () => {
    renderCommentedTurn();

    expect(
      screen.getAllByTestId("annotation-anchor").map((el) => el.textContent),
    ).toEqual(["Span span-7", "Span span-9"]);
  });

  it("leaves the turn counting only what was said about the turn", () => {
    renderCommentedTurn();

    expect(screen.getByTestId("chat-turn-row")).toHaveAttribute(
      "data-annotation-count",
      "1",
    );
  });
});

/**
 * A score is a project-wide key with no notion of a target and becomes a column
 * for the whole trace, so it is a judgement about the trace and nothing
 * narrower. See specs/traces-v2/anchored-comments.feature.
 */
describe("given the project has active annotation score keys", () => {
  const own = (over: Partial<AnnotationByTrace>) =>
    annotation({
      userId: "user-1",
      user: { id: "user-1", name: "Ada", image: null },
      ...over,
    });

  beforeEach(() => {
    mocks.activeScores = [
      {
        id: "score-1",
        name: "Helpfulness",
        description: null,
        dataType: "BOOLEAN",
        options: [{ label: "Good", value: "good" }],
      },
    ];
  });

  describe("when the reviewer comments on one part of the trace", () => {
    /** @scenario "A comment on one part of a trace is not offered scores" */
    it("offers no scores on the comment", () => {
      const onASpan = own({
        id: "annotation-on-span",
        anchorKind: "span",
        anchorId: "span-7",
      });
      mocks.storedAnnotations = [onASpan];
      renderRow({ anchoredAnnotations: [onASpan] });

      fireEvent.click(screen.getByLabelText("Edit annotation"));

      expect(screen.getByLabelText("Annotation composer")).toBeInTheDocument();
      expect(screen.queryByText("Scores")).not.toBeInTheDocument();
    });
  });

  describe("when the reviewer annotates the trace as a whole", () => {
    /** @scenario "A comment about the whole trace is still offered scores" */
    it("offers the scores as it always did", () => {
      renderRow();

      fireEvent.click(rail());

      expect(screen.getByText("Scores")).toBeInTheDocument();
      expect(screen.getByText("Helpfulness")).toBeInTheDocument();
    });
  });
});

/**
 * The composer belongs to the part the comment is about, so two comments on two
 * parts of one turn are two composers rather than one shared between them.
 */
describe("given a comment is being written about one span of a turn", () => {
  it("leaves the rail free to start a comment about the turn itself", () => {
    useAnnotationDraftStore.getState().openDraft({
      traceId: TRACE_ID,
      mode: "annotate",
      anchorKind: "span",
      anchorId: "span-7",
    });

    renderRow();

    expect(
      screen.queryByLabelText("Annotation composer"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add annotation/ }),
    ).toBeInTheDocument();
  });
});

describe("given a comment about one span of a turn is being edited from the rail", () => {
  it("docks the composer in the card's place", () => {
    const onASpan = annotation({
      id: "annotation-on-span",
      userId: "user-1",
      user: { id: "user-1", name: "Ada", image: null },
      anchorKind: "span",
      anchorId: "span-7",
    });
    mocks.storedAnnotations = [onASpan];
    renderRow({ anchoredAnnotations: [onASpan] });

    fireEvent.click(screen.getByLabelText("Edit annotation"));

    expect(draft()).toMatchObject({
      traceId: TRACE_ID,
      annotationId: "annotation-on-span",
      anchorKind: "span",
      anchorId: "span-7",
    });
    expect(screen.getByLabelText("Annotation composer")).toBeInTheDocument();
  });
});
