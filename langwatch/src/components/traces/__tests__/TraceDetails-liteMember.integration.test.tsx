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
// Mocks
// ---------------------------------------------------------------------------

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: "/",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(),
}));

vi.mock("../../../hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: vi.fn(),
}));

vi.mock("../../../hooks/useTraceDetailsState", () => ({
  useTraceDetailsState: () => ({
    trace: { data: null, isLoading: false },
  }),
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

vi.mock("../../../hooks/useAnnotationCommentStore", () => ({
  useAnnotationCommentStore: () => ({
    setCommentState: vi.fn(),
    resetComment: vi.fn(),
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    traces: {
      getEvaluations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    annotation: {
      createQueueItem: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
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

// Stub sub-components to isolate tab rendering
vi.mock("../../messages/Conversation", () => ({
  Conversation: () => <div data-testid="conversation">Conversation</div>,
}));
vi.mock("../Evaluations", () => ({
  Evaluations: () => <div>Evaluations</div>,
  EvaluationsCount: () => null,
  Guardrails: () => null,
  Blocked: () => null,
}));
vi.mock("../Events", () => ({
  Events: () => <div>Events</div>,
}));
vi.mock("../SequenceDiagram", () => ({
  SequenceDiagramContainer: () => <div>Sequence</div>,
}));
vi.mock("../SpanTree", () => ({
  SpanTree: () => <div>SpanTree</div>,
}));
vi.mock("../Summary", () => ({
  TraceSummary: () => <div>Summary</div>,
}));
vi.mock("../ShareButton", () => ({
  ShareButton: () => null,
}));
vi.mock("../AddParticipants", () => ({
  AddParticipants: () => null,
}));
vi.mock("../../AddAnnotationQueueDrawer", () => ({
  AddAnnotationQueueDrawer: () => null,
}));
vi.mock("../../ui/drawer", () => ({
  Drawer: {
    CloseTrigger: () => null,
  },
}));
vi.mock("../../ui/link", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));
vi.mock("../../ui/popover", () => {
  const P = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Popover: {
      Root: P,
      Trigger: P,
      Content: P,
      Arrow: () => null,
      CloseTrigger: () => null,
      Body: P,
    },
  };
});

import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useLiteMemberGuard } from "../../../hooks/useLiteMemberGuard";
import { TraceDetails } from "../TraceDetails";

const mockUseOrganizationTeamProject = vi.mocked(useOrganizationTeamProject);
const mockUseLiteMemberGuard = vi.mocked(useLiteMemberGuard);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup({ isLiteMember }: { isLiteMember: boolean }) {
  mockUseOrganizationTeamProject.mockReturnValue({
    project: { id: "proj-1", slug: "test" },
    hasPermission: () => true,
    organizationRole: isLiteMember
      ? OrganizationUserRole.EXTERNAL
      : OrganizationUserRole.MEMBER,
  } as unknown as ReturnType<typeof useOrganizationTeamProject>);

  mockUseLiteMemberGuard.mockReturnValue({ isLiteMember });

  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceDetails traceId="trace-1" />
    </ChakraProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceDetails tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when user is a lite member", () => {
    it("does not render the Trace Details tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: true });

      const tabs = queryAllByRole("tab").map((el) => el.textContent);
      expect(tabs).not.toContain("Trace Details");
    });

    it("does not render the Sequence tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: true });

      const tabs = queryAllByRole("tab").map((el) => el.textContent);
      expect(tabs).not.toContain("Sequence");
    });

    it("renders the Thread tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: true });

      const tabs = queryAllByRole("tab").map((el) => el.textContent);
      expect(tabs).toContain("Thread");
    });

    it("renders the Evaluations tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: true });

      const tabs = queryAllByRole("tab").map((el) => el.textContent?.trim());
      expect(tabs.some((t) => t?.startsWith("Evaluations"))).toBe(true);
    });

    it("renders the Events tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: true });

      const tabs = queryAllByRole("tab").map((el) => el.textContent?.trim());
      expect(tabs.some((t) => t?.startsWith("Events"))).toBe(true);
    });
  });

  describe("when user is a full member", () => {
    it("renders the Trace Details tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: false });

      const tabs = queryAllByRole("tab").map((el) => el.textContent);
      expect(tabs).toContain("Trace Details");
    });

    it("renders the Sequence tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: false });

      const tabs = queryAllByRole("tab").map((el) => el.textContent);
      expect(tabs).toContain("Sequence");
    });

    it("renders the Thread tab", () => {
      const { queryAllByRole } = setup({ isLiteMember: false });

      const tabs = queryAllByRole("tab").map((el) => el.textContent);
      expect(tabs).toContain("Thread");
    });
  });
});
