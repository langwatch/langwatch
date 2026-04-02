/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMappingsData,
  mockTeamsData,
  mockCustomRolesData,
  mockTokensData,
  mockCreateMutate,
  mockCreateWithNewTeamMutate,
  mockUpdateMutate,
  mockDeleteMutate,
  mockInvalidateListAll,
} = vi.hoisted(() => {
  return {
    mockMappingsData: {
      current: [] as Array<{
        id: string;
        externalGroupId: string;
        externalGroupName: string;
        teamId: string | null;
        teamName: string | null;
        projectName: string | null;
        role: string | null;
        customRoleId: string | null;
        customRoleName: string | null;
        memberCount: number;
        mapped: boolean;
        createdAt: Date;
        updatedAt: Date;
      }>,
    },
    mockTeamsData: {
      current: [] as Array<{
        id: string;
        name: string;
        slug: string;
        organizationId: string;
        projects: Array<{ id: string; name: string }>;
        members: never[];
      }>,
    },
    mockCustomRolesData: {
      current: [] as Array<{
        id: string;
        name: string;
        description: string | null;
        permissions: string[];
      }>,
    },
    mockTokensData: {
      current: [] as Array<{
        id: string;
        description: string | null;
        createdAt: Date;
        lastUsedAt: Date | null;
      }>,
    },
    mockCreateMutate: vi.fn(),
    mockCreateWithNewTeamMutate: vi.fn(),
    mockUpdateMutate: vi.fn(),
    mockDeleteMutate: vi.fn(),
    mockInvalidateListAll: vi.fn(),
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
    hasPermission: () => true,
  }),
}));

vi.mock("../../../components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    (Component: React.ComponentType) =>
    (props: Record<string, unknown>) => <Component {...props} />,
}));

vi.mock("../../../components/CopyInput", () => ({
  CopyInput: ({ value }: { value: string }) => (
    <input readOnly value={value} />
  ),
}));

vi.mock("../../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../../components/ui/dialog", () => ({
  Dialog: {
    Root: ({
      children,
      open,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange?: (details: { open: boolean }) => void;
    }) => (open ? <div data-testid="dialog">{children}</div> : null),
    Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Title: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CloseTrigger: () => null,
  },
}));

vi.mock("../../../utils/api", () => ({
  api: {
    useContext: () => ({
      scimGroupMapping: {
        listAll: { invalidate: mockInvalidateListAll },
      },
      scimToken: {
        list: { invalidate: vi.fn() },
      },
    }),
    scimGroupMapping: {
      listAll: {
        useQuery: () => ({ data: mockMappingsData.current, isLoading: false }),
      },
      create: {
        useMutation: () => ({
          mutate: mockCreateMutate,
          isLoading: false,
        }),
      },
      createWithNewTeam: {
        useMutation: () => ({
          mutate: mockCreateWithNewTeamMutate,
          isLoading: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutate: mockUpdateMutate,
          isLoading: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: mockDeleteMutate,
          isLoading: false,
        }),
      },
    },
    scimToken: {
      list: {
        useQuery: () => ({ data: mockTokensData.current, isLoading: false }),
      },
      generate: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      revoke: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
    },
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: mockTeamsData.current,
          isLoading: false,
        }),
      },
    },
    role: {
      getAll: {
        useQuery: () => ({
          data: mockCustomRolesData.current,
          isLoading: false,
        }),
      },
    },
  },
}));

const { default: ScimSettings } = await import("../scim");

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ScimSettings />
    </ChakraProvider>,
  );
}

describe("SCIM Group Mapping UI", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMappingsData.current = [];
    mockTeamsData.current = [];
    mockCustomRolesData.current = [];
    mockTokensData.current = [];
  });

  describe("when mappings table renders with mapped and unmapped groups", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-ro",
          teamId: null,
          teamName: null,
          projectName: null,
          role: null,
          customRoleId: null,
          customRoleName: null,
          memberCount: 0,
          mapped: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "mapping-2",
          externalGroupId: "ext-2",
          externalGroupName: "clienta-dev-rw",
          teamId: "team-1",
          teamName: "team-dev",
          projectName: "Project A",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          memberCount: 5,
          mapped: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    });

    it("shows group names in the table", () => {
      renderPage();

      expect(screen.getByText("clienta-dev-ro")).toBeTruthy();
      expect(screen.getByText("clienta-dev-rw")).toBeTruthy();
    });

    it("shows Mapped badge for mapped group and Unmapped for unmapped", () => {
      renderPage();

      expect(screen.getByText("Mapped")).toBeTruthy();
      expect(screen.getByText("Unmapped")).toBeTruthy();
    });

    it("shows team, project, role, and member count for mapped group", () => {
      renderPage();

      expect(screen.getByText("team-dev")).toBeTruthy();
      expect(screen.getByText("Project A")).toBeTruthy();
      expect(screen.getByText("MEMBER")).toBeTruthy();
      expect(screen.getByText("5")).toBeTruthy();
    });

    it("shows dashes for unmapped group columns", () => {
      renderPage();

      // The unmapped row has "-" for team, project, and role
      const dashes = screen.getAllByText("-");
      expect(dashes.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("when Edit button is clicked on an unmapped group", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-ro",
          teamId: null,
          teamName: null,
          projectName: null,
          role: null,
          customRoleId: null,
          customRoleName: null,
          memberCount: 0,
          mapped: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockTeamsData.current = [
        {
          id: "team-1",
          name: "team-dev",
          slug: "team-dev",
          organizationId: "org-1",
          projects: [{ id: "proj-1", name: "Project A" }],
          members: [],
        },
      ];
      mockCustomRolesData.current = [
        {
          id: "custom-role-1",
          name: "Auditor",
          description: "Audit role",
          permissions: ["read"],
        },
      ];
    });

    it("opens inline form with team and role fields", async () => {
      const user = userEvent.setup();
      renderPage();

      const editButtons = screen.getAllByLabelText("Edit mapping");
      await user.click(editButtons[0]!);

      // The inline form shows the group name and Save/Cancel buttons
      expect(screen.getByText("clienta-dev-ro")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });

    it("shows Team and Role labels in the inline form", async () => {
      const user = userEvent.setup();
      renderPage();

      const editButtons = screen.getAllByLabelText("Edit mapping");
      await user.click(editButtons[0]!);

      // "Team" appears as both a column header and a form label
      const teamLabels = screen.getAllByText("Team");
      expect(teamLabels.length).toBeGreaterThanOrEqual(2);
      // "Role" appears as both a column header and a form label
      const roleLabels = screen.getAllByText("Role");
      expect(roleLabels.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("when saving a mapping for an unmapped group", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-ro",
          teamId: null,
          teamName: null,
          projectName: null,
          role: null,
          customRoleId: null,
          customRoleName: null,
          memberCount: 0,
          mapped: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockTeamsData.current = [
        {
          id: "team-1",
          name: "team-dev",
          slug: "team-dev",
          organizationId: "org-1",
          projects: [{ id: "proj-1", name: "Project A" }],
          members: [],
        },
      ];
      mockCustomRolesData.current = [];
      mockCreateMutate.mockImplementation(
        (
          _args: unknown,
          opts: { onSuccess?: () => void; onError?: () => void },
        ) => {
          opts.onSuccess?.();
        },
      );
    });

    it("does not call create mutation when no team is selected", async () => {
      const user = userEvent.setup();
      renderPage();

      // Open inline form
      const editButtons = screen.getAllByLabelText("Edit mapping");
      await user.click(editButtons[0]!);

      // Click Save (default role is MEMBER since mapping.role is null)
      await user.click(screen.getByRole("button", { name: "Save" }));

      // The create mutation should NOT be called without a team selected
      // (selectedTeamId starts as null for unmapped groups)
      expect(mockCreateMutate).not.toHaveBeenCalled();
    });
  });

  describe("when team dropdown has Create new team option", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-ro",
          teamId: null,
          teamName: null,
          projectName: null,
          role: null,
          customRoleId: null,
          customRoleName: null,
          memberCount: 0,
          mapped: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockTeamsData.current = [
        {
          id: "team-1",
          name: "team-dev",
          slug: "team-dev",
          organizationId: "org-1",
          projects: [{ id: "proj-1", name: "Project A" }],
          members: [],
        },
      ];
    });

    it("includes Create new team option in team items list", async () => {
      const user = userEvent.setup();
      renderPage();

      const editButtons = screen.getAllByLabelText("Edit mapping");
      await user.click(editButtons[0]!);

      // Chakra Select renders items both as hidden <option> and visible <div>
      // Verify at least one element with the "Create new team..." text exists
      const createTeamItems = screen.getAllByText("Create new team...");
      expect(createTeamItems.length).toBeGreaterThanOrEqual(1);
    });

    it("shows teams grouped by project in team dropdown", async () => {
      const user = userEvent.setup();
      renderPage();

      const editButtons = screen.getAllByLabelText("Edit mapping");
      await user.click(editButtons[0]!);

      // Chakra Select renders items both as hidden <option> and visible <div>
      const teamItems = screen.getAllByText("team-dev (Project A)");
      expect(teamItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when role dropdown renders with custom roles", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-ro",
          teamId: null,
          teamName: null,
          projectName: null,
          role: null,
          customRoleId: null,
          customRoleName: null,
          memberCount: 0,
          mapped: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockTeamsData.current = [];
      mockCustomRolesData.current = [
        {
          id: "custom-role-1",
          name: "Auditor",
          description: "Audit access",
          permissions: ["read"],
        },
      ];
    });

    it("includes custom role alongside built-in roles", async () => {
      const user = userEvent.setup();
      renderPage();

      const editButtons = screen.getAllByLabelText("Edit mapping");
      await user.click(editButtons[0]!);

      // Chakra Select renders all role items in the DOM (both as hidden
      // <option> elements and as visible <div> items). Verify the custom
      // role "Auditor" is present alongside built-in roles.
      const auditorItems = screen.getAllByText("Auditor");
      expect(auditorItems.length).toBeGreaterThanOrEqual(1);

      // Verify built-in roles are also rendered
      const adminItems = screen.getAllByText("Admin");
      expect(adminItems.length).toBeGreaterThanOrEqual(1);
      const viewerItems = screen.getAllByText("Viewer");
      expect(viewerItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when Delete button is clicked", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-ro",
          teamId: "team-1",
          teamName: "team-dev",
          projectName: "Project A",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          memberCount: 3,
          mapped: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDeleteMutate.mockImplementation(
        (
          _args: unknown,
          opts: { onSuccess?: () => void; onError?: () => void },
        ) => {
          opts.onSuccess?.();
        },
      );
    });

    it("opens confirmation dialog and calls delete mutation", async () => {
      const user = userEvent.setup();
      renderPage();

      const deleteButtons = screen.getAllByLabelText("Delete mapping");
      await user.click(deleteButtons[0]!);

      // Confirmation dialog should appear
      const dialog = screen.getByTestId("dialog");
      expect(
        within(dialog).getByText("Delete Mapping"),
      ).toBeTruthy();
      expect(
        within(dialog).getByText(/Are you sure you want to delete/),
      ).toBeTruthy();

      // Click the Delete button in the dialog
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(mockDeleteMutate).toHaveBeenCalledWith(
        { organizationId: "org-1", mappingId: "mapping-1" },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it("invalidates listAll after successful delete", async () => {
      const user = userEvent.setup();
      renderPage();

      const deleteButtons = screen.getAllByLabelText("Delete mapping");
      await user.click(deleteButtons[0]!);

      const dialog = screen.getByTestId("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockInvalidateListAll).toHaveBeenCalled();
      });
    });
  });

  describe("when member count is displayed", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-rw",
          teamId: "team-1",
          teamName: "team-dev",
          projectName: "Project A",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          memberCount: 5,
          mapped: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    });

    it("shows the correct member count", () => {
      renderPage();

      expect(screen.getByText("5")).toBeTruthy();
    });
  });

  describe("when a mapping has a custom role", () => {
    beforeEach(() => {
      mockMappingsData.current = [
        {
          id: "mapping-1",
          externalGroupId: "ext-1",
          externalGroupName: "clienta-dev-custom",
          teamId: "team-1",
          teamName: "team-dev",
          projectName: "Project A",
          role: "CUSTOM",
          customRoleId: "cr-1",
          customRoleName: "Auditor",
          memberCount: 2,
          mapped: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    });

    it("displays custom role name instead of CUSTOM", () => {
      renderPage();

      expect(screen.getByText("Auditor")).toBeTruthy();
      expect(screen.queryByText("CUSTOM")).toBeNull();
    });
  });
});
