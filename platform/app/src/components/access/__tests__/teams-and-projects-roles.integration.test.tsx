/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createMock, updateMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ hasPermission: () => true }),
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));
vi.mock("~/components/settings/useDepartmentColumn", () => ({
  useDepartmentColumn: () => ({ show: false }),
}));
vi.mock("~/components/ui/dialog", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/components/ui/dialog")>();
  const Root = original.Dialog.Root;
  return {
    ...original,
    Dialog: {
      ...original.Dialog,
      // Keep portalled role options accessible in the jsdom dialog harness.
      Root: (props: ComponentProps<typeof Root>) => (
        <Root {...props} modal={false} />
      ),
    },
  };
});
vi.mock("~/utils/api", () => ({
  api: {
    team: {
      getTeamsWithRoleBindings: {
        useQuery: () => ({
          data: [
            {
              id: "team_1",
              name: "Engineering",
              slug: "engineering",
              projects: [{ id: "project_1", name: "Checkout" }],
              directMembers: [
                {
                  userId: "user_existing",
                  name: "Existing member",
                  image: null,
                  role: "MEMBER",
                  customRoleId: null,
                  bindingId: "binding_1",
                  viaGroupName: null,
                },
              ],
              projectOnlyAccess: [],
              projectAccess: {},
            },
          ],
          isLoading: false,
        }),
      },
    },
    role: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "role_auditor", name: "Auditor" }],
          isLoading: false,
        }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: {
            members: [
              {
                userId: "user_full",
                role: "MEMBER",
                user: { name: "Full member", email: "full@acme.test" },
              },
              {
                userId: "user_lite",
                role: "EXTERNAL",
                user: { name: "Lite member", email: "lite@acme.test" },
              },
            ],
          },
        }),
      },
    },
    roleBinding: {
      create: { useMutation: () => ({ mutate: createMock, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMock, isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      team: { getTeamsWithRoleBindings: { invalidate: vi.fn() } },
    }),
  },
}));

import { TeamsAndProjectsSection } from "../TeamsAndProjectsSection";

function renderTeams() {
  render(
    <ChakraProvider value={defaultSystem}>
      <TeamsAndProjectsSection organizationId="org_acme" />
    </ChakraProvider>,
  );
}

async function choose(trigger: HTMLElement, name: string | RegExp) {
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("option", { name }));
}

function dialogSelect(index: number): HTMLElement {
  const select = within(screen.getByRole("dialog")).getAllByRole("combobox")[
    index
  ];
  if (!select) throw new Error(`Missing selector ${index}`);
  return select;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given the teams and projects role editors", () => {
  describe("when a direct team assignment changes", () => {
    it("submits custom and built-in roles with their correct identifiers", async () => {
      renderTeams();
      await choose(screen.getByRole("combobox"), "Auditor");

      expect(updateMock).toHaveBeenLastCalledWith({
        organizationId: "org_acme",
        bindingId: "binding_1",
        role: "CUSTOM",
        customRoleId: "role_auditor",
      });
      await choose(screen.getByRole("combobox"), "Admin");
      expect(updateMock).toHaveBeenLastCalledWith({
        organizationId: "org_acme",
        bindingId: "binding_1",
        role: "ADMIN",
        customRoleId: void 0,
      });
    });
  });

  describe("when an external member replaces a full member in the team form", () => {
    it("replaces a previously selected custom role with Viewer before submitting", async () => {
      renderTeams();
      await userEvent.click(
        screen.getByRole("button", { name: "Add to team" }),
      );
      await choose(dialogSelect(0), /Full member/);
      await choose(dialogSelect(1), "Auditor");
      await choose(dialogSelect(0), /Lite member/);
      expect(dialogSelect(1)).toHaveTextContent("Viewer");
      await userEvent.click(dialogSelect(1));
      expect(screen.queryByRole("option", { name: "Auditor" })).toBeNull();
      expect(screen.queryByRole("option", { name: "Admin" })).toBeNull();
      await userEvent.click(screen.getByRole("option", { name: "Viewer" }));
      await userEvent.click(screen.getByRole("button", { name: "Add member" }));

      expect(createMock).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: "user_lite",
        role: "VIEWER",
        customRoleId: void 0,
        scopeType: "TEAM",
        scopeId: "team_1",
      });
    });
  });

  describe("when an external member is assigned project access", () => {
    it("retains the project's custom role choices and submits its project scope", async () => {
      renderTeams();
      await userEvent.click(
        screen.getByRole("button", { name: "Add person to this project" }),
      );
      await choose(dialogSelect(0), /Lite member/);
      await choose(dialogSelect(1), "Auditor");
      await userEvent.click(screen.getByRole("button", { name: "Add access" }));

      expect(createMock).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: "user_lite",
        role: "CUSTOM",
        customRoleId: "role_auditor",
        scopeType: "PROJECT",
        scopeId: "project_1",
      });
    });
  });
});
