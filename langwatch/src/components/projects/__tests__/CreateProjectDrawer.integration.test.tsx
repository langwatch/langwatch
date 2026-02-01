/**
 * @vitest-environment jsdom
 *
 * Integration tests for CreateProjectDrawer.
 * Verifies that the organizationId prop correctly overrides the context value
 * when creating projects from the dropdown in a different organization.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

import { CreateProjectDrawer } from "../CreateProjectDrawer";

// Track mutation calls to verify the organizationId used
let createProjectMutateCall:
  | {
      organizationId: string;
      name: string;
      teamId?: string;
      newTeamName?: string;
      language: string;
      framework: string;
    }
  | undefined;

const mockCloseDrawer = vi.fn();

// Current organization from context - simulates "Org A" where user is currently viewing
const CURRENT_ORG_ID = "org-a-id";
const CURRENT_ORG_NAME = "Org A";

// Target organization for project creation - simulates "Org B" from dropdown
const TARGET_ORG_ID = "org-b-id";

// Mock teams for the target organization
const MOCK_TEAMS = [
  { id: "team-1", name: "Engineering", projects: [] },
  { id: "team-2", name: "Data Science", projects: [] },
];

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    organization: { id: CURRENT_ORG_ID, name: CURRENT_ORG_NAME },
    project: null,
  })),
}));

vi.mock("../../../hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: vi.fn(() => ({
    checkAndProceed: (callback: () => void) => callback(),
    isLoading: false,
    isAllowed: true,
    limitInfo: { allowed: true, current: 1, max: 10 },
  })),
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: vi.fn(() => ({
    closeDrawer: mockCloseDrawer,
  })),
}));

vi.mock("../../../hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: vi.fn(() => ({
    url: "/settings/subscription",
  })),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    useContext: vi.fn(() => ({
      organization: { getAll: { invalidate: vi.fn() } },
      limits: { getUsage: { invalidate: vi.fn() } },
      team: { getTeamsWithMembers: { invalidate: vi.fn() } },
    })),
    project: {
      create: {
        useMutation: (callbacks?: {
          onSuccess?: (data: { projectSlug: string }) => void;
          onError?: (error: Error) => void;
        }) => ({
          mutate: (
            params: NonNullable<typeof createProjectMutateCall>,
          ) => {
            createProjectMutateCall = params;
            callbacks?.onSuccess?.({ projectSlug: "new-project" });
          },
          isLoading: false,
          error: null,
        }),
      },
    },
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: MOCK_TEAMS,
          isLoading: false,
        }),
      },
    },
    limits: {
      getUsage: {
        useQuery: () => ({
          data: {
            activePlan: { maxProjects: 10 },
            usage: { projects: 1 },
          },
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../../utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<CreateProjectDrawer/>", () => {
  beforeEach(() => {
    createProjectMutateCall = undefined;
    mockCloseDrawer.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when organizationId prop is provided", () => {
    it("uses provided organizationId for project creation instead of context", async () => {
      const user = userEvent.setup();

      // Render with explicit organizationId prop (Org B),
      // while context returns Org A
      render(
        <CreateProjectDrawer organizationId={TARGET_ORG_ID} />,
        { wrapper: Wrapper }
      );

      // Fill in the project name
      const projectNameInput = screen.getByPlaceholderText("AI Project");
      await user.type(projectNameInput, "My New Project");

      // Submit the form
      const createButton = screen.getByRole("button", { name: /create/i });
      await user.click(createButton);

      // Verify the mutation was called with the TARGET_ORG_ID (Org B),
      // not the CURRENT_ORG_ID (Org A) from context
      await waitFor(() => {
        expect(createProjectMutateCall).toBeDefined();
        expect(createProjectMutateCall?.organizationId).toBe(TARGET_ORG_ID);
        expect(createProjectMutateCall?.name).toBe("My New Project");
      });
    });
  });

  describe("when organizationId prop is not provided", () => {
    it("uses organization from context for project creation", async () => {
      const user = userEvent.setup();

      // Render without organizationId prop - should use context
      render(
        <CreateProjectDrawer />,
        { wrapper: Wrapper }
      );

      // Fill in the project name
      const projectNameInput = screen.getByPlaceholderText("AI Project");
      await user.type(projectNameInput, "My New Project");

      // Submit the form
      const createButton = screen.getByRole("button", { name: /create/i });
      await user.click(createButton);

      // Verify the mutation was called with the CURRENT_ORG_ID from context
      await waitFor(() => {
        expect(createProjectMutateCall).toBeDefined();
        expect(createProjectMutateCall?.organizationId).toBe(CURRENT_ORG_ID);
      });
    });
  });
});
