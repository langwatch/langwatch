/**
 * @vitest-environment jsdom
 * Group dialogs validate on submit: Create stays clickable and names the missing name; Save on an
 * unchanged group closes without a call. @see dev/docs/adr/018-form-validation-and-save.md
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ create: vi.fn(), applyEdits: vi.fn() }));

vi.mock("../behavior/organization-api.ts", () => {
  const answer = (path: string): unknown => {
    if (path === "group.getById") {
      return { id: "g1", name: "Engineering", scimSource: null, grants: [], members: [] };
    }
    if (path === "organization.getOrganizationWithMembersAndTheirTeams") {
      return { id: "org-1", name: "Acme", members: [], teams: [] };
    }
    return [];
  };
  const endpoint = (path: string) => ({
    useQuery: () => ({ data: answer(path), isError: false, isLoading: false, refetch: vi.fn() }),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: path === "group.applyEdits" ? calls.applyEdits : calls.create,
      isPending: false,
    }),
    invalidate: vi.fn(),
    fetch: vi.fn(),
  });
  const namespace = (prefix: string): Record<string, unknown> =>
    new Proxy(endpoint(prefix) as Record<string, unknown>, {
      get: (target: Record<string, unknown>, name) => {
        if (name in target) return target[name as string];
        if (typeof name !== "string") return void 0;
        return namespace(prefix ? `${prefix}.${name}` : name);
      },
    }) as Record<string, unknown>;
  const root = namespace("");
  root.useUtils = () => root;
  return { api: root };
});

import { renderWithOrganizationHost } from "../testing.tsx";
import { CreateGroupDialog } from "../ui/sections/create-group-dialog.tsx";
import { GroupDetailDialog } from "../ui/sections/group-detail-dialog.tsx";

const GROUP: Parameters<typeof GroupDetailDialog>[0]["group"] = {
  id: "g1",
  name: "Engineering",
  slug: "engineering",
  externalId: null,
  scimSource: null,
  memberCount: 0,
  grants: [],
  createdAt: new Date(0).toISOString(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given the create-group dialog", () => {
  describe("when Create group is pressed with no name", () => {
    it("says the name is missing, focuses it and creates nothing", async () => {
      const user = userEvent.setup();
      renderWithOrganizationHost(
        <CreateGroupDialog organizationId="org-1" open onClose={vi.fn()} />,
      );

      const create = await screen.findByTestId("groups-create-submit");
      expect(create).toBeEnabled();
      await user.click(create);

      expect(await screen.findByText("Enter a group name.")).toBeVisible();
      await waitFor(() => expect(screen.getByTestId("groups-create-name")).toHaveFocus());
      expect(calls.create).not.toHaveBeenCalled();
    });
  });
});

describe("given the group detail dialog with nothing changed", () => {
  describe("when Save is pressed", () => {
    it("closes without saving anything", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderWithOrganizationHost(
        <GroupDetailDialog group={GROUP} organizationId="org-1" canManage open onClose={onClose} />,
      );

      const save = await screen.findByRole("button", { name: "Save" });
      expect(save).toBeEnabled();
      await user.click(save);

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(calls.applyEdits).not.toHaveBeenCalled();
    });
  });
});
