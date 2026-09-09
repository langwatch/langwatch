/**
 * @vitest-environment jsdom
 *
 * The create-department drawer, mounted the way `CurrentDrawer` mounts it:
 * on its own, with the drawer navigation and the tRPC client as its only
 * boundaries.
 *
 * What it has to prove is the shape the model actually has. `model Department`
 * carries a name and nothing else a person sets, so the drawer offers exactly
 * one field — and a test that only checked the name was there would pass just
 * as happily on a drawer that had quietly grown three invented ones, so the
 * count of fields is asserted too.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  mutations: [] as Array<{ path: string; input: unknown }>,
  closed: 0,
}));

const MANAGER = ["organization:view", "governance:view", "governance:manage"];
const VIEWER = ["organization:view", "governance:view"];

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: () => {
      harness.closed += 1;
    },
    goBack: vi.fn(),
  }),
}));

vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (state: unknown) => unknown) =>
    selector({ isOpen: false, panelMode: "sidebar" }),
}));

vi.mock("~/utils/api", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useMutation") {
            return (options?: { onSuccess?: () => unknown }) => ({
              mutate: (input: unknown) => {
                harness.mutations.push({ path: path.join("."), input });
                void options?.onSuccess?.();
              },
              mutateAsync: vi.fn(),
              isPending: false,
              variables: undefined,
            });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  return { api: node([]) };
});

import { AddDepartmentDrawer } from "../AddDepartmentDrawer";

const renderDrawer = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AddDepartmentDrawer />
    </ChakraProvider>,
  );

beforeEach(() => {
  harness.permissions = MANAGER;
  harness.mutations = [];
  harness.closed = 0;
});

afterEach(() => cleanup());

describe("the create-department drawer", () => {
  describe("when a manager opens it", () => {
    /** @scenario "The create-department drawer collects every field the department model has" */
    it("offers the name and nothing the model does not store", async () => {
      renderDrawer();

      const dialog = await screen.findByRole("dialog");
      expect(
        await screen.findByRole("textbox", { name: "Department name" }),
      ).toBeInTheDocument();
      // The model stores an id, an organization, a name, two timestamps and an
      // archive stamp. Only the name is a person's to set, so one text box is
      // the whole form — and an extra field appearing here would mean the
      // drawer had invented a column.
      expect(dialog.querySelectorAll("input, textarea")).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: "Create" }),
      ).toBeInTheDocument();
    });

    /** @scenario "Creating a department from the drawer records it and closes" */
    it("sends the trimmed name to the create mutation and closes itself", async () => {
      renderDrawer();

      const field = await screen.findByRole("textbox", {
        name: "Department name",
      });
      const dialog = screen.getByRole("dialog");
      // The drawer moves focus to its own content as it opens, and a click
      // landing before that move is undone by it.
      await waitFor(() => expect(dialog).toHaveFocus());
      await userEvent.click(field);
      await waitFor(() => expect(field).toHaveFocus());
      await userEvent.type(field, "  Engineering  ");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() =>
        expect(harness.mutations).toContainEqual({
          path: "departments.create",
          input: { organizationId: "org-1", name: "Engineering" },
        }),
      );
      expect(harness.closed).toBeGreaterThan(0);
    });

    /** @scenario "A department with no name is refused at the field" */
    it("says so next to the field and sends nothing", async () => {
      renderDrawer();

      await screen.findByRole("dialog");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(
        await screen.findByText("Give the department a name."),
      ).toBeInTheDocument();
      expect(harness.mutations).toEqual([]);
    });
  });

  describe("when a reader without the manage grant reaches it by address", () => {
    /** @scenario "A viewer who reaches the create-department drawer is told which grant it needs" */
    it("names the grant instead of offering a form", async () => {
      harness.permissions = VIEWER;
      renderDrawer();

      await screen.findByRole("dialog");
      expect(screen.getByText(/governance:manage/)).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: "Department name" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Create" }),
      ).not.toBeInTheDocument();
    });
  });
});
