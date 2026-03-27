/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Annotation Scores settings page.
 *
 * Verifies permission-based UI visibility:
 * - "Add new score metric" button gated by annotations:manage
 * - "Actions" column header gated by annotations:manage
 */
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsLiteMemberRef,
  mockScoresList,
  mockToggleMutate,
  mockDeleteMutate,
} = vi.hoisted(() => {
  return {
    mockIsLiteMemberRef: {
      current: false,
    },
    mockScoresList: {
      current: [] as Array<{
        id: string;
        name: string;
        description: string;
        dataType: string;
        options: Array<{ label: string; value: number }>;
        active: boolean;
        projectId: string;
      }>,
    },
    mockToggleMutate: vi.fn(),
    mockDeleteMutate: vi.fn(),
  };
});

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    organizations: [{ id: "org-1", name: "Test Org" }],
    project: { id: "proj-1", slug: "test-project" },
    hasOrgPermission: () => false,
    hasAnyPermission: () => false,
  }),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({
    isLiteMember: mockIsLiteMemberRef.current,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    drawerOpen: () => false,
    closeDrawer: vi.fn(),
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: any) => C,
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotationScore: {
      getAll: {
        useQuery: () => ({
          data: mockScoresList.current,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      toggle: {
        useMutation: () => ({
          mutate: mockToggleMutate,
          isPending: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: mockDeleteMutate,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

vi.mock("~/components/annotations/DeleteConfirmationDialog", () => ({
  DeleteConfirmationDialog: () => <div data-testid="delete-dialog" />,
}));

vi.mock("~/components/NoDataInfoBlock", () => ({
  NoDataInfoBlock: () => <div data-testid="no-data-info-block" />,
}));

vi.mock("~/components/ui/layouts/PageLayout", () => ({
  PageLayout: {
    Header: ({ children }: { children?: ReactNode }) => (
      <div data-testid="page-header">{children}</div>
    ),
    Heading: ({ children }: { children?: ReactNode }) => (
      <div data-testid="page-heading">{children}</div>
    ),
    HeaderButton: ({
      children,
      ...props
    }: {
      children?: ReactNode;
      onClick?: () => void;
    }) => (
      <button data-testid="header-button" {...props}>
        {children}
      </button>
    ),
    Container: ({ children }: { children?: ReactNode }) => (
      <div data-testid="page-container">{children}</div>
    ),
    Content: ({ children }: { children?: ReactNode }) => (
      <div data-testid="page-content">{children}</div>
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
      value?: string;
      onClick?: (e: any) => void;
    }) => <div {...props}>{children}</div>,
  },
}));

vi.mock("~/components/ui/switch", () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: () => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onCheckedChange}
      data-testid="switch"
    />
  ),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({
    children,
    href,
  }: {
    children?: ReactNode;
    href?: string;
    isExternal?: boolean;
    color?: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode; content?: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@prisma/client", () => ({
  AnnotationScoreDataType: {
    CATEGORICAL: "CATEGORICAL",
    CHECKBOX: "CHECKBOX",
  },
}));

// Lazy import to ensure mocks are set up first
const { default: AnnotationScorePage } = await import(
  "~/pages/settings/annotation-scores"
);

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationScorePage />
    </ChakraProvider>,
  );
}

const sampleScores = [
  {
    id: "score-1",
    name: "Quality",
    description: "Quality score",
    dataType: "CATEGORICAL",
    options: [
      { label: "Good", value: 1 },
      { label: "Bad", value: 0 },
    ],
    active: true,
    projectId: "proj-1",
  },
];

describe("Annotation scores settings page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLiteMemberRef.current = false;
    mockScoresList.current = sampleScores;
  });

  describe("when user is not a lite member", () => {
    beforeEach(() => {
      mockIsLiteMemberRef.current = false;
    });

    it("displays the add new score metric button", () => {
      renderPage();

      expect(screen.getByText("Add new score metric")).toBeTruthy();
    });

    it("displays the actions column", () => {
      renderPage();

      expect(screen.getByText("Actions")).toBeTruthy();
    });
  });

  describe("when user is a lite member", () => {
    beforeEach(() => {
      mockIsLiteMemberRef.current = true;
    });

    it("hides the add new score metric button", () => {
      renderPage();

      expect(screen.queryByText("Add new score metric")).toBeNull();
    });

    it("hides the actions column", () => {
      renderPage();

      expect(screen.queryByText("Actions")).toBeNull();
    });
  });
});
