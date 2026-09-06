/**
 * @vitest-environment jsdom
 *
 * The boxed action cluster each message of a turn carries. A turn is a trace,
 * so its two messages are the trace's own input and output, and a comment or a
 * correction left on one records which of them it was about. Both message
 * layouts offer it the same way. See specs/traces-v2/annotations.feature and
 * specs/traces-v2/anchored-comments.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({ canManageAnnotations: true }));

vi.mock("../../scenarioRoles", async () => {
  const actual = await vi.importActual<typeof import("../../scenarioRoles")>(
    "../../scenarioRoles",
  );
  return { ...actual, useIsScenarioRole: () => false };
});

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage"
        ? mocks.canManageAnnotations
        : permission === "annotations:view",
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: null,
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    translate: {
      translate: {
        useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }),
      },
    },
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
    },
  },
}));

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useAnnotationDraftStore } from "../../../../stores/annotationDraftStore";
import { NO_TRACE_EVENTS, type TraceListItem } from "../../../../types/trace";
import { ChatTurnRow } from "../ChatTurnRow";
import type { TurnLayout } from "../types";

const TRACE_ID = "trace-1";

function turn(over: Partial<TraceListItem> = {}): TraceListItem {
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
    input: "a question",
    output: "the original answer",
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
    ...over,
  } as TraceListItem;
}

function anchored(anchorPath: "input" | "output", id: string) {
  return {
    id,
    projectId: "proj-1",
    traceId: TRACE_ID,
    comment: `about the ${anchorPath}`,
    isThumbsUp: null,
    userId: "user-2",
    user: { id: "user-2", name: "Grace", image: null },
    email: null,
    scoreOptions: {},
    expectedOutput: null,
    anchorKind: "field",
    anchorId: TRACE_ID,
    anchorPath,
    createdAt: new Date("2026-08-01T10:30:00Z"),
    updatedAt: new Date("2026-08-01T10:30:00Z"),
  } as unknown as AnnotationByTrace;
}

function renderTurn({
  layout = "thread" as TurnLayout,
  turnItem = turn(),
  anchoredAnnotationItems = [] as AnnotationByTrace[],
  userText = "a question",
  assistantText = "the original answer",
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChatTurnRow
        layout={layout}
        turn={turnItem}
        userText={userText}
        assistantText={assistantText}
        assistantReasoning=""
        gapSecs={0}
        showGap={false}
        index={1}
        isCurrent={false}
        onSelect={() => undefined}
        anchoredAnnotationItems={anchoredAnnotationItems}
      />
    </ChakraProvider>,
  );
}

const draft = () => useAnnotationDraftStore.getState().draft;

const CLUSTER_LABEL = {
  message: "Message actions",
  reply: "Reply actions",
} as const;

const cluster = (side: "message" | "reply") =>
  screen.getByRole("group", { name: CLUSTER_LABEL[side] });

const annotateOn = (side: "message" | "reply") =>
  within(cluster(side)).getByRole("button", {
    name: side === "message" ? "Annotate this message" : "Annotate this reply",
  });

const suggestOn = (side: "message" | "reply") =>
  within(cluster(side)).getByRole("button", {
    name:
      side === "message"
        ? "Suggest what this message should have been"
        : "Suggest what this reply should have said",
  });

beforeEach(() => {
  mocks.canManageAnnotations = true;
  useAnnotationDraftStore.setState({ draft: null });
  cleanup();
});

describe.each([
  "thread",
  "bubbles",
] as const)("given a turn read in %s layout", (layout) => {
  describe("when the reviewer reads what a message offers", () => {
    /** @scenario "Each message offers Translate, Annotate and Suggest on hover" */
    it("reads Translate, Annotate and Suggest in that order on both messages", () => {
      renderTurn({ layout });

      for (const side of ["message", "reply"] as const) {
        expect(
          within(cluster(side))
            .getAllByRole("button")
            .map((button) => button.textContent),
        ).toEqual(["Translate", "Annotate", "Suggest"]);
      }
    });

    /** @scenario "Either side of a turn takes a comment and a correction" */
    it("offers a comment and a correction on either side", () => {
      renderTurn({ layout });

      expect(annotateOn("message")).toBeInTheDocument();
      expect(suggestOn("message")).toBeInTheDocument();
      expect(annotateOn("reply")).toBeInTheDocument();
      expect(suggestOn("reply")).toBeInTheDocument();
    });
  });

  describe("when the reviewer comments on the message the user sent", () => {
    /** @scenario "Commenting on one side of a turn records which side it was left on" */
    it("records the comment as being about the turn's input", async () => {
      renderTurn({ layout });

      fireEvent.click(annotateOn("message"));

      await vi.waitFor(() =>
        expect(draft()).toMatchObject({
          traceId: TRACE_ID,
          mode: "annotate",
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "input",
        }),
      );
    });
  });

  describe("when the reviewer comments on the reply", () => {
    /** @scenario "Commenting on one side of a turn records which side it was left on" */
    it("records the comment as being about the turn's output", async () => {
      renderTurn({ layout });

      fireEvent.click(annotateOn("reply"));

      await vi.waitFor(() =>
        expect(draft()).toMatchObject({
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "output",
        }),
      );
    });
  });

  describe("when the reviewer suggests what the user message should have been", () => {
    /** @scenario "Suggest on the user message pre-fills the message text" */
    it("opens on the turn's input, pre-filled with what it said", async () => {
      renderTurn({ layout });

      fireEvent.click(suggestOn("message"));

      await vi.waitFor(() =>
        expect(draft()).toMatchObject({
          mode: "suggest",
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "input",
          expectedOutput: "a question",
        }),
      );
    });
  });

  describe("when the reviewer suggests what the reply should have said", () => {
    /** @scenario "Either side of a turn takes a comment and a correction" */
    it("opens on the turn's output, pre-filled with what it said", async () => {
      renderTurn({ layout });

      fireEvent.click(suggestOn("reply"));

      await vi.waitFor(() =>
        expect(draft()).toMatchObject({
          mode: "suggest",
          anchorPath: "output",
          expectedOutput: "the original answer",
        }),
      );
    });
  });
});

describe("given a turn whose input a privacy rule hid", () => {
  /** @scenario "A side of a turn a privacy rule hid offers nothing to comment on" */
  it("offers nothing to comment on for that side", () => {
    renderTurn({
      turnItem: turn({ inputRedacted: true }),
      userText: "",
    });

    expect(
      screen.queryByRole("group", { name: CLUSTER_LABEL.message }),
    ).not.toBeInTheDocument();
    expect(annotateOn("reply")).toBeInTheDocument();
  });
});

describe("given a reviewer who may read annotations but not write them", () => {
  beforeEach(() => {
    mocks.canManageAnnotations = false;
  });

  /** @scenario "A reviewer who may only read annotations is offered no comment action" */
  it("offers no message any way to be commented on or corrected", () => {
    renderTurn();

    expect(
      screen.queryByRole("button", { name: /^Annotate this/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Suggest what this/ }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Each action asks for the permission its own work needs" */
  it("still offers to translate each message", () => {
    renderTurn();

    for (const side of ["message", "reply"] as const) {
      expect(
        within(cluster(side))
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Translate"]);
    }
  });
});

describe("given a turn commented on its input and twice on its output", () => {
  /** @scenario "Each side of a turn shows the comments left on it" */
  it("counts each side's comments on the message they were left on", () => {
    renderTurn({
      anchoredAnnotationItems: [
        anchored("input", "on-input"),
        anchored("output", "on-output-1"),
        anchored("output", "on-output-2"),
      ],
    });

    expect(screen.getByLabelText("1 annotation")).toBeInTheDocument();
    expect(screen.getByLabelText("2 annotations")).toBeInTheDocument();
  });
});

describe("given a comment being written on one side of a turn", () => {
  /** @scenario "Commenting on a side of a turn writes in that turn's rail" */
  it("holds that side's actions on screen while it is written", async () => {
    renderTurn();
    fireEvent.click(annotateOn("reply"));

    await vi.waitFor(() =>
      expect(getComputedStyle(cluster("reply")).opacity).toBe("1"),
    );
    // The other side's actions go back to waiting for the pointer.
    expect(getComputedStyle(cluster("message")).opacity).toBe("0");
  });
});
