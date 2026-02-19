/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Secrets settings page.
 *
 * Covers scenarios from specs/secrets/secrets-manager.feature:
 * - Renders the secrets list
 * - Shows Add Secret button when user has manage permission
 * - Hides Add Secret button when user lacks manage permission
 * - Shows empty state when no secrets exist
 */
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockHasPermissionRef,
  mockSecretsList,
  mockListRefetch,
  mockCreateMutateAsync,
  mockUpdateMutateAsync,
  mockDeleteMutateAsync,
} = vi.hoisted(() => {
  return {
    mockHasPermissionRef: {
      current: (_permission: string): boolean => true,
    },
    mockSecretsList: {
      current: [] as Array<{
        id: string;
        projectId: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        createdBy: { name: string } | null;
        updatedBy: { name: string } | null;
      }>,
    },
    mockListRefetch: vi.fn(),
    mockCreateMutateAsync: vi.fn(),
    mockUpdateMutateAsync: vi.fn(),
    mockDeleteMutateAsync: vi.fn(),
  };
});

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
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

vi.mock("../../../components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/DashboardLayout", () => ({
  ProjectSelector: () => <div data-testid="project-selector" />,
}));

vi.mock("../../../utils/api", () => ({
  api: {
    useContext: () => ({
      secrets: {
        list: {
          invalidate: vi.fn(),
        },
      },
    }),
    secrets: {
      list: {
        useQuery: () => ({
          data: mockSecretsList.current,
          isLoading: false,
          refetch: mockListRefetch,
        }),
      },
      create: {
        useMutation: () => ({
          mutateAsync: mockCreateMutateAsync,
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: mockUpdateMutateAsync,
          isPending: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutateAsync: mockDeleteMutateAsync,
          isPending: false,
        }),
      },
    },
  },
}));

// Lazy import to ensure mocks are set up first
const { default: SecretsPage } = await import("../secrets");

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SecretsPage />
    </ChakraProvider>,
  );
}

describe("Secrets settings page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermissionRef.current = () => true;
    mockSecretsList.current = [];
  });

  describe("when secrets exist", () => {
    beforeEach(() => {
      mockSecretsList.current = [
        {
          id: "secret-1",
          projectId: "proj-1",
          name: "OPENAI_API_KEY",
          createdAt: new Date("2025-01-15T10:00:00Z"),
          updatedAt: new Date("2025-01-20T14:30:00Z"),
          createdBy: { name: "Alice" },
          updatedBy: { name: "Bob" },
        },
        {
          id: "secret-2",
          projectId: "proj-1",
          name: "ANTHROPIC_API_KEY",
          createdAt: new Date("2025-01-10T08:00:00Z"),
          updatedAt: new Date("2025-01-10T08:00:00Z"),
          createdBy: { name: "Charlie" },
          updatedBy: null,
        },
      ];
    });

    it("renders the secrets list with name and metadata", () => {
      renderPage();

      expect(screen.getByText("OPENAI_API_KEY")).toBeTruthy();
      expect(screen.getByText("ANTHROPIC_API_KEY")).toBeTruthy();
      expect(screen.getByText("Alice")).toBeTruthy();
      expect(screen.getByText("Charlie")).toBeTruthy();
    });

    it("displays the page heading", () => {
      renderPage();

      expect(screen.getByText("Secrets")).toBeTruthy();
    });
  });

  describe("when user has secrets:manage permission", () => {
    beforeEach(() => {
      mockHasPermissionRef.current = (permission: string) =>
        permission === "secrets:manage" || permission === "secrets:view";
    });

    it("displays the Add Secret button", () => {
      renderPage();

      expect(
        screen.getByRole("button", { name: /add secret/i }),
      ).toBeTruthy();
    });
  });

  describe("when user lacks secrets:manage permission", () => {
    beforeEach(() => {
      mockHasPermissionRef.current = (permission: string) =>
        permission === "secrets:view";
    });

    it("hides the Add Secret button", () => {
      renderPage();

      expect(
        screen.queryByRole("button", { name: /add secret/i }),
      ).toBeNull();
    });
  });

  describe("when no secrets exist", () => {
    beforeEach(() => {
      mockSecretsList.current = [];
    });

    it("displays the empty state", () => {
      renderPage();

      expect(screen.getByText("No secrets configured")).toBeTruthy();
      expect(
        screen.getByText(
          /Add secrets to use in code blocks/,
        ),
      ).toBeTruthy();
    });
  });
});
