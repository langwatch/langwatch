/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Experiments page permission-based UI visibility.
 *
 * Verifies that each experiment action uses the permission enforced by its
 * server procedure.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGuardPermissionRef,
  mockHasPermissionRef,
  mockExperimentsList,
  mockDeleteMutate,
} = vi.hoisted(() => {
  return {
    mockGuardPermissionRef: { current: "" },
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

vi.mock("~/utils/compat/next-router", () => ({
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
  withPermissionGuard: (permission: string) => {
    mockGuardPermissionRef.current = permission;
    return (Component: any) => Component;
  },
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

vi.mock("~/components/experiments/CreateExperimentButton", () => ({
  CreateExperimentButton: () => <div data-testid="create-experiment-button" />,
}));

vi.mock("~/components/experiments/CopyExperimentDialog", () => ({
  CopyExperimentDialog: () => <div data-testid="copy-experiment-dialog" />,
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
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}));

vi.mock("~/components/ui/menu", () => ({
  Menu: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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

vi.mock("~/server/experiments/workbenchState", () => ({
  TASK_TYPES: {
    real_time: "real_time",
    llm_app: "llm_app",
    prompt_creation: "prompt_creation",
    custom_evaluator: "custom_evaluator",
    scan: "scan",
  },
}));

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
const { GuardedExperimentsPage: ExperimentsPage } = await import(
  "~/pages/[project]/evaluations"
);

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ExperimentsPage />
    </ChakraProvider>,
  );
}

describe("given the Experiments page permission model", () => {
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
        type: "EVALUATIONS_V3" as const,
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

  describe("when the page guard is registered", () => {
    it("requires experiments:view", () => {
      expect(mockGuardPermissionRef.current).toBe("experiments:view");
    });
  });

  describe("when every matching permission is granted", () => {
    it("shows all experiment actions", () => {
      renderPage();

      expect(screen.getByText("Edit")).toBeTruthy();
      expect(screen.getByText("Delete")).toBeTruthy();
      expect(screen.getByText("Replicate to another project")).toBeTruthy();
    });
  });

  describe("when only workflows:create is granted", () => {
    it("shows only edit", () => {
      mockHasPermissionRef.current = (permission: string) =>
        permission === "workflows:create";
      renderPage();

      expect(screen.getByText("Edit")).toBeTruthy();
      expect(screen.queryByText("Delete")).toBeNull();
      expect(screen.queryByText("Replicate to another project")).toBeNull();
    });
  });

  describe("when only workflows:delete is granted", () => {
    it("shows only delete", () => {
      mockHasPermissionRef.current = (permission: string) =>
        permission === "workflows:delete";
      renderPage();

      expect(screen.getByText("Delete")).toBeTruthy();
      expect(screen.queryByText("Edit")).toBeNull();
      expect(screen.queryByText("Replicate to another project")).toBeNull();
    });
  });

  describe("when only evaluations:manage is granted", () => {
    it("shows only replicate", () => {
      mockHasPermissionRef.current = (permission: string) =>
        permission === "evaluations:manage";
      renderPage();

      expect(screen.getByText("Replicate to another project")).toBeTruthy();
      expect(screen.queryByText("Edit")).toBeNull();
      expect(screen.queryByText("Delete")).toBeNull();
    });
  });
});
