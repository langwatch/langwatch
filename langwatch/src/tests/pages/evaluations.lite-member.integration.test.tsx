/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Evaluations page permission-based UI visibility.
 *
 * Verifies that delete and replicate menu items are gated behind
 * the `evaluations:manage` permission for lite members.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockHasPermissionRef, mockExperimentsList, mockDeleteMutate } =
  vi.hoisted(() => {
    return {
      mockHasPermissionRef: {
        current: (_permission: string): boolean => true,
      },
      mockExperimentsList: {
        current: [] as Array<{
          id: string;
          name: string;
          slug: string;
          type: string;
          createdAt: string;
          updatedAt: number;
          workbenchState: null;
          runsSummary: {
            count: number;
            primaryMetric: undefined;
            latestRun: { timestamps: undefined };
          };
          dataset: null;
        }>,
      },
      mockDeleteMutate: vi.fn(),
    };
  });

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    organizations: [{ id: "org-1", name: "Test Org" }],
    project: { id: "proj-1", slug: "test-project" },
    hasPermission: (permission: string) =>
      mockHasPermissionRef.current(permission),
    hasOrgPermission: () => false,
    hasAnyPermission: () => false,
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: any) => C,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({}),
    experiments: {
      getAllForEvaluationsList: {
        useQuery: () => ({
          data: {
            experiments: mockExperimentsList.current,
            totalHits: mockExperimentsList.current.length,
          },
          isLoading: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      deleteExperiment: {
        useMutation: ({ onSuccess }: any = {}) => ({
          mutate: mockDeleteMutate,
          isPending: false,
        }),
      },
    },
    monitors: {
      getAllForProject: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: vi.fn(() => false),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("~/components/evaluations/NewEvaluationMenu", () => ({
  NewEvaluationMenu: () => <div data-testid="new-evaluation-menu" />,
}));

vi.mock("~/components/evaluations/CopyEvaluationDialog", () => ({
  CopyEvaluationDialog: () => <div data-testid="copy-evaluation-dialog" />,
}));

vi.mock("~/components/evaluations/MonitorsSection", () => ({
  MonitorsSection: () => <div data-testid="monitors-section" />,
}));

vi.mock("~/components/NavigationFooter", () => ({
  useNavigationFooter: () => ({
    pageOffset: 0,
    pageSize: 25,
    useUpdateTotalHits: vi.fn(),
  }),
  NavigationFooter: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/OverflownText", () => ({
  OverflownTextWithTooltip: ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("~/components/NoDataInfoBlock", () => ({
  NoDataInfoBlock: () => <div data-testid="no-data-info-block" />,
}));

vi.mock("~/components/ui/layouts/PageLayout", () => ({
  PageLayout: {
    Header: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Heading: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    HeaderButton: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Container: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Content: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
  },
}));

vi.mock("~/components/ui/menu", () => ({
  Menu: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Content: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Item: ({
      children,
      ...props
    }: {
      children?: ReactNode;
      [key: string]: any;
    }) => <div {...props}>{children}</div>,
  },
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href?: string;
    [key: string]: any;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock(
  "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore",
  () => ({
    TASK_TYPES: {
      real_time: "real_time",
      llm_app: "llm_app",
      prompt_creation: "prompt_creation",
      custom_evaluator: "custom_evaluator",
      scan: "scan",
    },
  }),
);

vi.mock(
  "~/components/experiments/BatchEvaluationV2/BatchEvaluationSummary",
  () => ({
    formatEvaluationSummary: vi.fn(() => ""),
  }),
);

vi.mock("@prisma/client", () => ({
  ExperimentType: {
    BATCH_EVALUATION: "BATCH_EVALUATION",
    BATCH_EVALUATION_V2: "BATCH_EVALUATION_V2",
    DSPY: "DSPY",
    EVALUATIONS_V3: "EVALUATIONS_V3",
  },
}));

// Lazy import to ensure mocks are set up first
const { default: EvaluationsPage } = await import(
  "~/pages/[project]/evaluations"
);

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EvaluationsPage />
    </ChakraProvider>,
  );
}

describe("Evaluations page permission visibility", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermissionRef.current = () => true;
    mockExperimentsList.current = [
      {
        id: "exp-1",
        name: "Test Evaluation",
        slug: "test-evaluation",
        type: "BATCH_EVALUATION" as const,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        workbenchState: null,
        runsSummary: {
          count: 0,
          primaryMetric: undefined,
          latestRun: { timestamps: undefined },
        },
        dataset: null,
      },
    ];
  });

  describe("when user has evaluations:manage permission", () => {
    beforeEach(() => {
      mockHasPermissionRef.current = () => true;
    });

    it("displays the delete menu item", () => {
      renderPage();

      expect(screen.getByText("Delete")).toBeTruthy();
    });

    it("displays the replicate menu item", () => {
      renderPage();

      expect(
        screen.getByText("Replicate to another project"),
      ).toBeTruthy();
    });
  });

  describe("when user lacks evaluations:manage permission", () => {
    beforeEach(() => {
      mockHasPermissionRef.current = (permission: string) =>
        permission !== "evaluations:manage";
    });

    it("hides the delete menu item", () => {
      renderPage();

      expect(screen.queryByText("Delete")).toBeNull();
    });

    it("hides the replicate menu item", () => {
      renderPage();

      expect(
        screen.queryByText("Replicate to another project"),
      ).toBeNull();
    });
  });
});
