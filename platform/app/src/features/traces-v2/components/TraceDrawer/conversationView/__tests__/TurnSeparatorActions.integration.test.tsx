/**
 * @vitest-environment jsdom
 *
 * What the turn separator carries once everything said about a message is said
 * on the message itself: one action, opening the turn's trace to correct it,
 * and — while a queue is being walked — the tick that counts the turn into the
 * sitting. See specs/traces-v2/annotations.feature and
 * packages/features/annotation/specs/annotation-queue-workflow.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  canUpdateAnnotations: true,
}));

vi.mock("../../scenarioRoles", async () => {
  const actual =
    await vi.importActual<typeof import("../../scenarioRoles")>("../../scenarioRoles");
  return { ...actual, useIsScenarioRole: () => false };
});

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:update" ? mocks.canUpdateAnnotations : false,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
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

import {
  isSessionMarked,
  useAnnotationQueueSessionStore,
  useDrawerStore,
  useTraceEditStore,
} from "@langwatch/trace-web";
import { NO_TRACE_EVENTS, type TraceListItem } from "../../../../types/trace";
import { enterTraceEditMode } from "../../../../utils/traceEditMode";
import { ChatTurnRow } from "../ChatTurnRow";

const TRACE_ID = "trace-1";
const OCCURRED_AT_MS = 1_754_640_000_000;

function turn(): TraceListItem {
  return {
    traceId: TRACE_ID,
    timestamp: OCCURRED_AT_MS,
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
  } as TraceListItem;
}

function renderTurn({ showSessionCheckbox = false } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChatTurnRow
        layout="thread"
        turn={turn()}
        userText="a question"
        assistantText="the original answer"
        assistantReasoning=""
        gapSecs={0}
        showGap={false}
        index={1}
        isCurrent={false}
        onSelect={() => undefined}
        showSessionCheckbox={showSessionCheckbox}
      />
    </ChakraProvider>,
  );
}

const editTrace = () => screen.getByRole("button", { name: "Edit trace" });

const turnActions = () => screen.getByRole("group", { name: "Turn actions" });

/** The separator the actions belong to, and the hover group they answer. */
const separator = () =>
  screen.getByText("Turn 1").closest('[role="group"]') as HTMLElement;

const sessionCheckbox = () =>
  screen.getByRole("checkbox", {
    name: "Count this turn in the annotation session",
  });

beforeEach(() => {
  mocks.openDrawer.mockClear();
  mocks.canUpdateAnnotations = true;
  useAnnotationQueueSessionStore.setState({
    active: true,
    marks: {},
    handoff: "idle",
  });
  useDrawerStore.getState().closeDrawer();
  useDrawerStore.getState().setViewModeTransient("summary");
  useTraceEditStore.getState().discard();
  useTraceEditStore.getState().clearPendingExit();
  cleanup();
});

describe("given a reviewer who may correct annotated traces", () => {
  describe("when they read a turn separator", () => {
    /** @scenario "The turn separator offers to edit the turn's trace" */
    it("offers one action, to edit the trace", () => {
      renderTurn();

      const actions = screen.getByRole("group", { name: "Turn actions" });

      expect([...actions.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
        "Edit trace",
      ]);
    });
  });

  describe("when they choose it while reading the conversation", () => {
    /** @scenario "The turn separator offers to edit the turn's trace" */
    it("opens that turn's trace for editing, off the conversation tab", () => {
      useDrawerStore.getState().setViewModeTransient("conversation");
      renderTurn();

      fireEvent.click(editTrace());

      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: TRACE_ID,
        t: String(OCCURRED_AT_MS),
        urlParams: { edit: "1" },
      });
      expect(useDrawerStore.getState().viewMode).toBe("summary");
    });
  });
});

describe("given the reader's pointer is elsewhere", () => {
  /** @scenario "The turn's actions stay away until the pointer is on the turn" */
  it("keeps the turn's actions out of the way", () => {
    renderTurn();

    expect(getComputedStyle(turnActions()).opacity).toBe("0");
  });
});

describe("given the reader's pointer is on the turn", () => {
  // The reveal resolves against `.group` on the separator, not against its
  // role. Naming only the role left the actions at opacity 0 for every reader,
  // on every turn.
  /** @scenario "The turn's actions arrive when the pointer is on the turn" */
  it("reveals the turn's actions", () => {
    renderTurn();

    separator().setAttribute("data-hover", "");

    expect(getComputedStyle(turnActions()).opacity).toBe("1");
  });

  /** @scenario "The turn's actions arrive when the pointer is on the turn" */
  it("brings them in on a surface of their own", () => {
    renderTurn();
    separator().setAttribute("data-hover", "");

    const surface = getComputedStyle(turnActions());
    // Opaque, because the actions land over the turn ledger and reading one
    // through the other leaves both illegible.
    expect(surface.backgroundColor).not.toBe("");
    expect(surface.backgroundColor).not.toBe("transparent");
    expect(surface.borderRadius).not.toBe("");
  });
});

describe("given a reviewer who may not update annotations", () => {
  /** @scenario "A reviewer who cannot update annotations is offered no correction" */
  it("is offered no way to edit the trace", () => {
    mocks.canUpdateAnnotations = false;

    renderTurn();

    expect(screen.queryByRole("button", { name: "Edit trace" })).not.toBeInTheDocument();
  });
});

describe("given the drawer is already open on another trace's conversation", () => {
  // The drawer must already hold the asked-for state when the address changes:
  // a URL that asks for state the store does not hold yet leaves the shell's
  // URL sync and the page-level hydrator rewriting the URL against each other.
  /** @scenario "Edit trace works while the drawer is already open on the conversation" */
  it("moves the drawer store first, so the address only confirms it", () => {
    useDrawerStore.getState().openTrace("other-trace", 111);
    useDrawerStore.getState().setViewModeTransient("conversation");
    renderTurn();

    fireEvent.click(editTrace());

    const drawer = useDrawerStore.getState();
    expect(drawer.traceId).toBe(TRACE_ID);
    expect(drawer.isEditing).toBe(true);
    expect(drawer.viewMode).toBe("summary");
    expect(useTraceEditStore.getState().editingTraceId).toBe(TRACE_ID);
    expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
      traceId: TRACE_ID,
      t: String(OCCURRED_AT_MS),
      urlParams: { edit: "1" },
    });
  });
});

describe("given the drawer is closed", () => {
  /** @scenario "The turn separator offers to edit the turn's trace" */
  it("leaves the opening to the address, so the hydrator mounts the drawer", () => {
    renderTurn();

    fireEvent.click(editTrace());

    expect(useDrawerStore.getState().traceId).toBeNull();
    expect(useDrawerStore.getState().isEditing).toBe(false);
    expect(useTraceEditStore.getState().editingTraceId).toBeNull();
    expect(mocks.openDrawer).toHaveBeenCalledOnce();
  });
});

describe("given an unsaved correction on another turn's trace", () => {
  function startDirtyCorrectionOn(traceId: string) {
    useDrawerStore.getState().openTrace(traceId, 111);
    enterTraceEditMode(traceId);
    useTraceEditStore.getState().setTraceOutput({
      text: "corrected",
      baselineText: "original",
    });
  }

  /** @scenario "Edit trace on another turn with unsaved changes asks first" */
  it("asks before discarding, and cancelling keeps everything", () => {
    startDirtyCorrectionOn("other-trace");
    renderTurn();

    fireEvent.click(editTrace());

    expect(mocks.openDrawer).not.toHaveBeenCalled();
    expect(useTraceEditStore.getState().pendingExit).not.toBeNull();
    expect(useDrawerStore.getState().traceId).toBe("other-trace");
    expect(useTraceEditStore.getState().traceOutputDraft).not.toBeNull();

    useTraceEditStore.getState().clearPendingExit();

    expect(useDrawerStore.getState().traceId).toBe("other-trace");
    expect(useTraceEditStore.getState().editingTraceId).toBe("other-trace");
    expect(useTraceEditStore.getState().traceOutputDraft).not.toBeNull();
  });

  /** @scenario "Edit trace on another turn with unsaved changes asks first" */
  it("moves to the turn's trace once the discard is confirmed", () => {
    startDirtyCorrectionOn("other-trace");
    renderTurn();

    fireEvent.click(editTrace());
    // What the discard dialog's confirm does: leave the old session, then run
    // the parked move.
    const run = useTraceEditStore.getState().pendingExit;
    useTraceEditStore.getState().discard();
    useDrawerStore.getState().setIsEditing(false);
    run?.();

    expect(useDrawerStore.getState().traceId).toBe(TRACE_ID);
    expect(useDrawerStore.getState().isEditing).toBe(true);
    expect(useTraceEditStore.getState().editingTraceId).toBe(TRACE_ID);
    expect(mocks.openDrawer).toHaveBeenCalledOnce();
  });
});

describe("given the turn's own trace is already being corrected", () => {
  /** @scenario "Re-entering edit mode on the same trace keeps the draft" */
  it("re-opens the editor without asking and keeps the draft", () => {
    useDrawerStore.getState().openTrace(TRACE_ID, OCCURRED_AT_MS);
    enterTraceEditMode(TRACE_ID);
    useTraceEditStore.getState().setTraceOutput({
      text: "corrected",
      baselineText: "original",
    });
    useDrawerStore.getState().setViewModeTransient("conversation");
    renderTurn();

    fireEvent.click(editTrace());

    expect(mocks.openDrawer).toHaveBeenCalledOnce();
    expect(useTraceEditStore.getState().pendingExit).toBeNull();
    expect(useTraceEditStore.getState().editingTraceId).toBe(TRACE_ID);
    expect(useTraceEditStore.getState().traceOutputDraft).not.toBeNull();
    expect(useDrawerStore.getState().isEditing).toBe(true);
  });
});

describe("given a queue being walked", () => {
  describe("when the reviewer reads a turn separator", () => {
    /** @scenario "The session checkbox leads the separator" */
    it("puts the session tick at the left end, ahead of the ledger", () => {
      renderTurn({ showSessionCheckbox: true });

      const tick = sessionCheckbox();
      const leadingSlot = separator().firstElementChild!;

      expect(leadingSlot.contains(tick)).toBe(true);
      expect(
        tick.compareDocumentPosition(screen.getByText("Turn 1")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("when the reviewer ticks a turn", () => {
    /** @scenario "A turn is counted in or out by hand" */
    it("counts that turn's trace into the sitting", async () => {
      renderTurn({ showSessionCheckbox: true });

      await userEvent.click(sessionCheckbox());

      expect(
        isSessionMarked(useAnnotationQueueSessionStore.getState().marks, TRACE_ID),
      ).toBe(true);
    });

    /** @scenario "A counted turn's separator reads as counted" */
    it("reads the separator the way the turn under review reads", async () => {
      renderTurn({ showSessionCheckbox: true });
      expect(separator()).toHaveAttribute("data-highlighted", "false");

      await userEvent.click(sessionCheckbox());
      expect(separator()).toHaveAttribute("data-highlighted", "true");

      await userEvent.click(sessionCheckbox());
      expect(separator()).toHaveAttribute("data-highlighted", "false");
    });
  });

  describe("when the pointer leaves a turn the sitting counts", () => {
    // Ticking leaves the checkbox holding focus. Revealing the actions on
    // anything focused anywhere in the separator left Edit trace lit on every
    // counted turn, long after the pointer had moved on.
    /** @scenario "The turn's actions leave with the pointer even on a counted turn" */
    it("takes Edit trace with it and leaves the tick on screen", async () => {
      renderTurn({ showSessionCheckbox: true });

      await userEvent.click(sessionCheckbox());
      await userEvent.unhover(sessionCheckbox());

      // The tick still holds focus, which is what used to keep the whole
      // cluster lit once the pointer had gone.
      expect(sessionCheckbox()).toHaveFocus();
      expect(sessionCheckbox()).toBeChecked();
      expect(getComputedStyle(turnActions()).opacity).toBe("0");
    });
  });

  describe("when a turn was already counted in", () => {
    /** @scenario "Annotating a turn counts its trace into the session" */
    it("reads as ticked", () => {
      useAnnotationQueueSessionStore.getState().noteAnnotationSaved(TRACE_ID);

      renderTurn({ showSessionCheckbox: true });

      expect(sessionCheckbox()).toBeChecked();
    });
  });
});

describe("given a conversation read outside a queue", () => {
  it("offers no session tick", () => {
    renderTurn();

    expect(
      screen.queryByRole("checkbox", {
        name: "Count this turn in the annotation session",
      }),
    ).not.toBeInTheDocument();
  });
});
