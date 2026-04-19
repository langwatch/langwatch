/**
 * @vitest-environment jsdom
 *
 * Integration tests for TraceDetails tab visibility based on lite member status.
 * Verifies that EXTERNAL users do not see "Trace Details" or "Sequence" tabs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";

// ---------------------------------------------------------------------------
// Stubs — child components that aren't under test
// vi.hoisted ensures these are available when vi.mock runs (hoisted above imports)
// ---------------------------------------------------------------------------

const { Stub, NullStub } = vi.hoisted(() => ({
  Stub: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
  useLiteMemberGuard: vi.fn(),
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
    traces: { getEvaluations: { useQuery: () => ({ data: [], isLoading: false }) } },
    annotation: { createQueueItem: { useMutation: () => ({ mutate: vi.fn() }) } },
    ops: { getScope: { useQuery: () => ({ data: null, isLoading: false, isSuccess: false }) } },
    useContext: () => ({
      annotation: {
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/components/messages/Conversation", () => ({ Conversation: () => <div>Conversation</div> }));
vi.mock("~/components/traces/Evaluations", () => ({ Evaluations: () => <div>Evaluations</div>, EvaluationsCount: NullStub, Guardrails: NullStub, Blocked: NullStub }));
vi.mock("~/components/traces/Events", () => ({ Events: () => <div>Events</div> }));
vi.mock("~/components/traces/SequenceDiagram", () => ({ SequenceDiagramContainer: () => <div>Sequence</div> }));
vi.mock("~/components/traces/SpanTree", () => ({ SpanTree: () => <div>SpanTree</div> }));
vi.mock("~/components/traces/Summary", () => ({ TraceSummary: () => <div>Summary</div> }));
vi.mock("~/components/traces/ShareButton", () => ({ ShareButton: NullStub }));
vi.mock("~/components/traces/AddParticipants", () => ({ AddParticipants: NullStub }));
vi.mock("~/components/AddAnnotationQueueDrawer", () => ({ AddAnnotationQueueDrawer: NullStub }));
vi.mock("~/components/ui/drawer", () => ({ Drawer: { CloseTrigger: NullStub } }));
vi.mock("~/components/ui/link", () => ({ Link: Stub }));
vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));
vi.mock("~/components/ui/popover", () => ({
  Popover: { Root: Stub, Trigger: Stub, Content: Stub, Arrow: NullStub, CloseTrigger: NullStub, Body: Stub },
}));

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useLiteMemberGuard } from "~/hooks/useLiteMemberGuard";
import { TraceDetails } from "~/components/traces/TraceDetails";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTabs({ isLiteMember }: { isLiteMember: boolean }) {
  vi.mocked(useOrganizationTeamProject).mockReturnValue({
    project: { id: "proj-1", slug: "test" },
    hasPermission: () => true,
    organizationRole: isLiteMember
      ? OrganizationUserRole.EXTERNAL
      : OrganizationUserRole.MEMBER,
  } as unknown as ReturnType<typeof useOrganizationTeamProject>);

  vi.mocked(useLiteMemberGuard).mockReturnValue({ isLiteMember });

  const { queryAllByRole } = render(
    <ChakraProvider value={defaultSystem}>
      <TraceDetails traceId="trace-1" />
    </ChakraProvider>,
  );

  return queryAllByRole("tab").map((el) => (el.textContent ?? "").trim());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceDetails tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when user is a lite member", () => {
    it("hides Trace Details and Sequence tabs but shows Thread, Evaluations, Events", () => {
      const tabs = renderTabs({ isLiteMember: true });

      expect(tabs).not.toContain("Trace Details");
      expect(tabs).not.toContain("Sequence");
      expect(tabs).toContain("Thread");
      expect(tabs.some((t) => t.startsWith("Evaluations"))).toBe(true);
      expect(tabs.some((t) => t.startsWith("Events"))).toBe(true);
    });
  });

  describe("when user is a full member", () => {
    it("shows Trace Details, Sequence, and Thread tabs", () => {
      const tabs = renderTabs({ isLiteMember: false });

      expect(tabs).toContain("Trace Details");
      expect(tabs).toContain("Sequence");
      expect(tabs).toContain("Thread");
    });
  });
});
