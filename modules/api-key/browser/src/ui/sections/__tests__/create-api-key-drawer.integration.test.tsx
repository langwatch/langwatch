/**
 * @vitest-environment jsdom
 * Pins what the create drawer sends: reset on open, key type, permission mode, payload.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
vi.mock("@langwatch/design-system/scope-chip-picker", () => ({
  ScopeChipPicker: ({
    onChange,
  }: {
    onChange: (next: { scopeType: string; scopeId: string }[]) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onChange([])}>
        Clear scope
      </button>
      <button type="button" onClick={() => onChange([{ scopeType: "PROJECT", scopeId: "proj-1" }])}>
        Use Web App
      </button>
    </div>
  ),
}));

vi.mock("@langwatch/design-system/provider-scope-chips", () => ({
  ProviderScopeChips: () => null,
}));

vi.mock("@langwatch/design-system/scope-filter", () => ({ ScopeFilter: () => null }));

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

function renderDrawer({
  isOpen = true,
  bindingsFailed = false,
  bindingsLoading = false,
  isCreating = false,
}: {
  isOpen?: boolean;
  bindingsFailed?: boolean;
  bindingsLoading?: boolean;
  isCreating?: boolean;
} = {}) {
  const onCreate = vi.fn<(input: CreateApiKeyInput) => void>();
  const refetch = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const props = {
    isCreating,
    myBindings: {
      refetch,
      data: bindingsFailed
        ? undefined
        : [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "MEMBER" as const }],
      isLoading: bindingsLoading,
      isError: bindingsFailed,
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
  return { onCreate, refetch };
}

const nameInput = () => screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev");
const createButton = () => screen.getByRole("button", { name: "Create secret key" });

async function chooseExpiration({
  user,
  label,
}: {
  user: ReturnType<typeof userEvent.setup>;
  label: string;
}) {
  await user.click(screen.getByText("Choose when this key expires"));
  await user.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  state.members = [];
});

afterEach(() => cleanup());

describe("given a member who is not an admin", () => {
  describe("when a named key is created with all permissions", () => {
    /** @scenario The mint drawer offers no role chooser */
    it("sends a personal key on the current project, role from the reader's binding", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      expect(screen.queryByText("Key type")).toBeNull();
      // Set directly: on a cold, loaded run the drawer's focus trap can land mid-typing and
      // swallow keystrokes, leaving the button disabled. This test pins the payload.
      const nameInput = screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev");
      fireEvent.change(nameInput, { target: { value: "CI" } });
      const descriptionInput = screen.getByPlaceholderText("What is this key used for?");
      fireEvent.change(descriptionInput, { target: { value: "pipeline" } });
      await chooseExpiration({ user, label: "No expiration" });
      expect(createButton()).toBeEnabled();
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
      await chooseExpiration({ user, label: "No expiration" });
      fireEvent.click(screen.getByText("Restricted"));
      expect(await screen.findByTestId("counter")).toHaveTextContent("0");
      await user.click(createButton());
      expect(onCreate).not.toHaveBeenCalled();
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

describe("given a named key with no expiry chosen", () => {
  describe("when the creator has not chosen yet", () => {
    /** @scenario "Create stays unavailable until an expiry is chosen" */
    it("asks for a choice and refuses Create until one is made", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      fireEvent.change(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), {
        target: { value: "CI" },
      });
      expect(screen.getByTestId("api-key-expiration-hint")).toHaveTextContent(
        "Choose when this key expires",
      );
      await user.click(createButton());
      expect(onCreate).not.toHaveBeenCalled();
      await chooseExpiration({ user, label: "No expiration" });
      expect(screen.queryByTestId("api-key-expiration-hint")).toBeNull();
      await user.click(createButton());
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("when No expiration is chosen", () => {
    /** @scenario "Choosing no expiration mints a key with no expiry" */
    it("sends no expiry", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      fireEvent.change(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), {
        target: { value: "CI" },
      });
      await chooseExpiration({ user, label: "No expiration" });
      await user.click(createButton());
      expect(onCreate.mock.calls[0]?.[0]?.expiresAt).toBeUndefined();
    });
  });

  describe("when 30 days is chosen", () => {
    /** @scenario "Choosing a preset mints a key that expires that many days from now" */
    it("sends an expiry 30 days from now", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      fireEvent.change(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), {
        target: { value: "CI" },
      });
      const before = Date.now();
      await chooseExpiration({ user, label: "30 days" });
      await user.click(createButton());
      const after = Date.now();
      const sent = onCreate.mock.calls[0]?.[0]?.expiresAt;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(sent?.epochMilliseconds).toBeGreaterThanOrEqual(before + thirtyDays);
      expect(sent?.epochMilliseconds).toBeLessThanOrEqual(after + thirtyDays);
    });
  });
});

describe("given the read of the caller's access fails", () => {
  describe("when a named key could be created", () => {
    /** @scenario "A key minted by someone holding a grant on an archived team keeps the minter's role" */
    it("shows the error and keeps Create disabled instead of falling back to a viewer key", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer({ bindingsFailed: true });
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "CI");
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't read your access");
      expect(createButton()).toBeDisabled();
      expect(screen.getByLabelText(/Couldn't read your access\. Retry above/)).toBeInTheDocument();
      expect(onCreate).not.toHaveBeenCalled();
    });

    /** @scenario "A failed read of the caller's access can be retried from the drawer" */

    it("retries the read without closing the form or losing what was entered", async () => {
      const user = userEvent.setup();
      const { refetch } = renderDrawer({ bindingsFailed: true });
      await user.type(nameInput(), "CI");
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(nameInput()).toHaveValue("CI");
      expect(screen.getByText("Create new secret key")).toBeInTheDocument();
    });
  });
});

describe("given a creator who submits an incomplete form", () => {
  describe("when nothing has been filled in and the scope is cleared", () => {
    /** @scenario "Every unmet requirement of a new key is named and the first is focused" */
    it("names every missing requirement, focuses the first and mints nothing", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      await user.click(screen.getByRole("button", { name: "Clear scope" }));
      await user.click(screen.getByText("Restricted"));
      await user.click(createButton());
      expect(screen.getByText("Enter a name for this key.")).toBeInTheDocument();
      expect(screen.getByText("Choose where this key can be used.")).toBeInTheDocument();
      expect(
        screen.getByText("Choose at least one permission, or switch to All."),
      ).toBeInTheDocument();
      expect(screen.getByTestId("api-key-expiration-hint")).toBeInTheDocument();
      await waitFor(() => expect(nameInput()).toHaveFocus());
      expect(onCreate).not.toHaveBeenCalled();
    });
  });

  describe("when one field is fixed and the form is submitted again", () => {
    it("keeps what was entered, drops that error and moves focus to the next gap", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      await user.click(screen.getByRole("button", { name: "Clear scope" }));
      await user.click(createButton());
      await user.type(nameInput(), "CI");
      await chooseExpiration({ user, label: "No expiration" });
      await user.click(createButton());
      expect(nameInput()).toHaveValue("CI");
      expect(screen.queryByText("Enter a name for this key.")).toBeNull();
      expect(screen.getByText("Choose where this key can be used.")).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Clear scope" })).toHaveFocus(),
      );
      await user.click(screen.getByRole("button", { name: "Use Web App" }));
      await user.click(createButton());
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate.mock.calls[0]?.[0]?.name).toBe("CI");
    });
  });

  describe("when only the scope is missing", () => {
    it("explains the scope, focuses it and mints nothing", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      await user.type(nameInput(), "CI");
      await chooseExpiration({ user, label: "No expiration" });
      await user.click(screen.getByRole("button", { name: "Clear scope" }));
      await user.click(createButton());
      expect(screen.getByText("Choose where this key can be used.")).toBeInTheDocument();
      expect(screen.queryByText("Enter a name for this key.")).toBeNull();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Clear scope" })).toHaveFocus(),
      );
      expect(onCreate).not.toHaveBeenCalled();
    });
  });

  describe("when only the restricted permissions are missing", () => {
    it("explains the permissions, focuses them and clears the error once one is chosen", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer();
      await user.type(nameInput(), "CI");
      await chooseExpiration({ user, label: "No expiration" });
      await user.click(screen.getByText("Restricted"));
      await user.click(createButton());
      expect(
        screen.getByText("Choose at least one permission, or switch to All."),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Pick traces view" })).toHaveFocus(),
      );
      expect(onCreate).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Pick traces view" }));
      expect(screen.queryByText("Choose at least one permission, or switch to All.")).toBeNull();
    });
  });

  describe("when a create is already in flight", () => {
    it("refuses a second submission", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderDrawer({ isCreating: true });
      await user.type(nameInput(), "CI");
      await chooseExpiration({ user, label: "No expiration" });
      await user.click(screen.getByTestId("api-key-create-submit"));
      expect(onCreate).not.toHaveBeenCalled();
    });
  });
});

describe("given the caller's access is still loading", () => {
  describe("when the drawer is open", () => {
    it("keeps Create disabled and says why", () => {
      renderDrawer({ bindingsLoading: true });
      expect(createButton()).toBeDisabled();
      expect(screen.getByText(/Reading your access/)).toBeInTheDocument();
      expect(
        screen.getByLabelText(/Reading your access\. Create is available/),
      ).toBeInTheDocument();
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
      await chooseExpiration({ user, label: "No expiration" });
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
      await chooseExpiration({ user, label: "No expiration" });
      await user.click(createButton());
      expect(onCreate.mock.calls[0]?.[0]?.assignedToUserId).toBeUndefined();
      expect(onCreate.mock.calls[0]?.[0]?.keyType).toBe("personal");
    });
  });
});
