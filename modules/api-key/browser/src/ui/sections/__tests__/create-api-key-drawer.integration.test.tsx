/**
 * @vitest-environment jsdom
 * Pins what the create drawer sends: reset on open, key type, permission mode, payload.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithApiKeyHost } from "../../../testing.tsx";
import { CreateApiKeyDrawer, type CreateApiKeyInput } from "../create-api-key-drawer.tsx";

const { state } = vi.hoisted(() => ({
  state: { members: [] as { id: string; name: string; email: string }[] },
}));

vi.mock("../../../behavior/api-key-api.ts", () => ({
  apiKeyApi: {
    apiKey: { orgMembers: { useQuery: () => ({ data: state.members, isLoading: false }) } },
  },
}));

// The picker has its own suite in authz; this file pins what the drawer sends.
vi.mock("@langwatch/authz-browser-kit", () => ({
  ScopeChipPicker: () => null,
  ProviderScopeChips: () => null,
  ScopeFilter: () => null,
}));

vi.mock("../../blocks/permission-category-list.tsx", () => ({
  PermissionCounter: ({ count }: { count: number }) => <span data-testid="counter">{count}</span>,
  PermissionCategoryList: ({ onChange }: { onChange: (next: Record<string, string>) => void }) => (
    <button type="button" onClick={() => onChange({ traces: "view", datasets: "none" })}>
      Pick traces view
    </button>
  ),
}));

const ADMIN_MEMBERS = [
  { id: "user-1", name: "Jane", email: "jane@acme.test" },
  { id: "user-2", name: "Bob", email: "bob@acme.test" },
];

function renderDrawer({ isOpen = true }: { isOpen?: boolean } = {}) {
  const onCreate = vi.fn<(input: CreateApiKeyInput) => void>();
  const props = {
    isCreating: false,
    myBindings: {
      data: [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "MEMBER" as const }],
      isLoading: false,
    },
    orgProjects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
    orgTeams: [{ id: "team-1", name: "Platform" }],
    organizationId: "org-1",
    organizationName: "ACME",
    currentTeamId: "team-1",
    currentProjectId: "proj-1",
    onClose: () => void 0,
    onCreate,
  };
  function Toggled() {
    const [open, setOpen] = useState(isOpen);
    return (
      <>
        <button type="button" onClick={() => setOpen((was) => !was)}>
          Toggle drawer
        </button>
        <CreateApiKeyDrawer {...props} isOpen={open} />
      </>
    );
  }
  renderWithApiKeyHost(<Toggled />);
  return { onCreate };
}

const createButton = () => screen.getByRole("button", { name: "Create secret key" });

beforeEach(() => {
  state.members = [];
});

afterEach(() => cleanup());

describe("given a member who is not an admin", () => {
  describe("when a named key is created with all permissions", () => {
    it("sends a personal key on the current project, role from the reader's binding", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      expect(screen.queryByText("Key type")).toBeNull();
      expect(createButton()).toBeDisabled();
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "CI");
      await user.type(screen.getByPlaceholderText("What is this key used for?"), "pipeline");
      await user.click(createButton());
      expect(onCreate.mock.calls).toEqual([
        [
          {
            name: "CI",
            description: "pipeline",
            expiresAt: undefined,
            permissionMode: "all",
            keyType: "personal",
            assignedToUserId: undefined,
            scopeType: "PROJECT",
            scopeId: "proj-1",
            permissions: undefined,
            bindings: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: "proj-1" }],
          },
        ],
      ]);
    });
  });

  describe("when restricted permissions are chosen", () => {
    it("waits for a selection, then sends the computed permissions under a custom role", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "Scoped");
      fireEvent.click(screen.getByText("Restricted"));
      expect(await screen.findByTestId("counter")).toHaveTextContent("0");
      expect(createButton()).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Pick traces view" }));
      expect(screen.getByTestId("counter")).toHaveTextContent("1");
      await user.click(createButton());
      const sent = onCreate.mock.calls[0]?.[0];
      expect(sent?.permissionMode).toBe("restricted");
      expect(sent?.permissions).toEqual(expect.arrayContaining(["traces:view"]));
      expect(sent?.bindings).toEqual([{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "proj-1" }]);
    });
  });

  describe("when the drawer is closed and opened again", () => {
    it("clears what was typed", async () => {
      const user = userEvent.setup();
      renderDrawer();
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "Old");
      fireEvent.click(screen.getByText("Toggle drawer"));
      fireEvent.click(screen.getByText("Toggle drawer"));
      expect(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev")).toHaveValue("");
    });
  });
});

describe("given an admin", () => {
  describe("when a service key is created", () => {
    it("sends a service key with the admin role and no assignee", async () => {
      state.members = ADMIN_MEMBERS;
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      expect(screen.getByText("Key type")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Service"));
      expect(await screen.findByText(/Not tied to any user/)).toBeInTheDocument();
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "Bot");
      await user.click(createButton());
      const sent = onCreate.mock.calls[0]?.[0];
      expect(sent?.keyType).toBe("service");
      expect(sent?.assignedToUserId).toBeUndefined();
      expect(sent?.bindings).toEqual([{ role: "ADMIN", scopeType: "PROJECT", scopeId: "proj-1" }]);
    });
  });

  describe("when a personal key is created for themselves", () => {
    it("sends no assignee", async () => {
      state.members = ADMIN_MEMBERS;
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "Mine");
      await user.click(createButton());
      expect(onCreate.mock.calls[0]?.[0]?.assignedToUserId).toBeUndefined();
      expect(onCreate.mock.calls[0]?.[0]?.keyType).toBe("personal");
    });
  });
});
