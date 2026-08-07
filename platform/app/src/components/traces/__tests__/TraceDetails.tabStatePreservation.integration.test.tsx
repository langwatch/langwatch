/**
 * @vitest-environment jsdom
 *
 * #5588 gave TraceDetails `lazyMount` without `unmountOnExit`, on the grounds
 * that the Thread tab reaches AnnotationComment's react-hook-form draft, which
 * a remount would discard. That reasoning was arrived at by reading the code;
 * nothing enforced it, so adding `unmountOnExit` in a later performance pass
 * would silently throw a half-written annotation away (the state-loss class
 * already hit once in #5456).
 *
 * Scope of this test: the container's mount behaviour, which is where the
 * regression risk lives. The Thread tab's subtree is stubbed by a probe that
 * holds local React state, standing in for the react-hook-form draft several
 * levels below it. Mounting the real Conversation -> TraceMessages ->
 * Annotations -> AnnotationComment chain would need a pile of tRPC and session
 * mocks and would test those, not the tab. Asserting only that the props are
 * set would be non-discriminating; this asserts the behaviour they buy.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { Stub, NullStub } = vi.hoisted(() => ({
  Stub: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  NullStub: () => null,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: "/",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: false }),
}));

vi.mock("~/hooks/useTraceDetailsState", () => ({
  useTraceDetailsState: () => ({ trace: { data: null, isLoading: false } }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    goBack: vi.fn(),
    canGoBack: false,
  }),
}));

vi.mock("~/hooks/useAnnotationCommentStore", () => ({
  useAnnotationCommentStore: () => ({
    setCommentState: vi.fn(),
    resetComment: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getEvaluations: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    annotation: {
      createQueueItem: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    pinnedTrace: {
      getPin: { useQuery: () => ({ data: null, isLoading: false }) },
    },
    ops: {
      getScope: {
        useQuery: () => ({ data: null, isLoading: false, isSuccess: false }),
      },
    },
    useContext: () => ({
      annotation: {
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
    }),
  },
}));

// The probe: local React state at the position AnnotationComment's
// `useForm` draft occupies. If the Thread panel is unmounted on exit, this
// state goes with it.
const DRAFT_PLACEHOLDER = "annotation draft probe";
// Deliberately not the tabs' own labels: querying for "User Events" or
// "Sequence" would match the trigger buttons, and an assertion that a panel is
// unmounted would pass for the wrong reason.
const EVENTS_PANEL_BODY = "user events panel body";

vi.mock("~/components/messages/Conversation", () => ({
  Conversation: () => {
    const [draft, setDraft] = useState("");
    return (
      <input
        placeholder={DRAFT_PLACEHOLDER}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    );
  },
}));

vi.mock("~/components/traces/Evaluations", () => ({
  Evaluations: () => <div>Evaluations</div>,
  EvaluationsCount: NullStub,
  Guardrails: NullStub,
  Blocked: NullStub,
}));
vi.mock("~/components/traces/Events", () => ({
  Events: () => <div>{EVENTS_PANEL_BODY}</div>,
}));
vi.mock("~/components/traces/SequenceDiagram", () => ({
  SequenceDiagramContainer: () => <div>Sequence diagram</div>,
}));
vi.mock("~/components/traces/SpanTree", () => ({
  SpanTree: () => <div>SpanTree</div>,
}));
vi.mock("~/components/traces/Summary", () => ({
  TraceSummary: () => <div>Summary</div>,
}));
vi.mock("~/components/traces/PinButton", () => ({ PinButton: NullStub }));
vi.mock("~/components/traces/AddParticipants", () => ({
  AddParticipants: NullStub,
}));
vi.mock("~/components/AddAnnotationQueueDrawer", () => ({
  AddAnnotationQueueDrawer: NullStub,
}));
vi.mock("~/components/ui/drawer", () => ({
  Drawer: { CloseTrigger: NullStub },
}));
vi.mock("~/components/ui/link", () => ({ Link: Stub }));
vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));
vi.mock("~/components/ui/popover", () => ({
  Popover: {
    Root: Stub,
    Trigger: Stub,
    Content: Stub,
    Arrow: NullStub,
    CloseTrigger: NullStub,
    Body: Stub,
  },
}));

import { TraceDetails } from "~/components/traces/TraceDetails";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

const TYPED_DRAFT = "half-written annotation";

function renderTraceDetails() {
  vi.mocked(useOrganizationTeamProject).mockReturnValue({
    project: { id: "proj-1", slug: "test" },
    hasPermission: () => true,
    organizationRole: OrganizationUserRole.MEMBER,
  } as unknown as ReturnType<typeof useOrganizationTeamProject>);

  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceDetails traceId="trace-1" selectedTab="messages" />
    </ChakraProvider>,
  );
}

function draftInput() {
  return screen.getByPlaceholderText(DRAFT_PLACEHOLDER);
}

async function switchTo(name: RegExp | string) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

describe("TraceDetails tab state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a draft is typed on the Thread tab and the user leaves and returns", () => {
    it("preserves the typed draft", async () => {
      renderTraceDetails();

      await userEvent.type(draftInput(), TYPED_DRAFT);
      expect(draftInput()).toHaveValue(TYPED_DRAFT);

      await switchTo("Trace Details");
      await switchTo("Thread");

      await waitFor(() => {
        expect(draftInput()).toHaveValue(TYPED_DRAFT);
      });
    });
  });

  describe("when the user leaves and returns to the Thread tab", () => {
    it("reuses the Thread panel DOM node rather than remounting it", async () => {
      renderTraceDetails();

      const beforeSwitch = draftInput();

      await switchTo("Trace Details");
      await switchTo("Thread");

      // Same DOM node, not a fresh one: the mechanism the draft survival
      // depends on, asserted directly so a failure names which half broke.
      await waitFor(() => {
        expect(draftInput()).toBe(beforeSwitch);
      });
    });
  });

  describe("given the User Events tab has never been opened", () => {
    it("leaves the User Events panel unmounted", () => {
      renderTraceDetails();

      // lazyMount's own half of the contract, and the reason #5588 touched
      // this component at all. Asserted on the User Events panel rather than
      // Trace Details or Sequence: those two are additionally hand-gated by an
      // inner `selectedTab === ...` check, so they stay empty with or without
      // lazyMount and would not notice the prop going away.
      expect(screen.queryByText(EVENTS_PANEL_BODY)).toBeNull();
    });

    describe("when the user opens the User Events tab", () => {
      it("mounts the User Events panel", async () => {
        renderTraceDetails();

        await switchTo(/User Events/);

        expect(screen.getByText(EVENTS_PANEL_BODY)).toBeInTheDocument();
      });
    });
  });
});
