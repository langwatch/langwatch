/**
 * @vitest-environment jsdom
 * Pins what the edit drawer sends: only changed text, the permission mode, and the bindings.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApiKeyHost } from "../../../testing.tsx";
import { EditApiKeyDrawer } from "../edit-api-key-drawer.tsx";

// The picker has its own suite in authz; this file pins what the drawer sends.
vi.mock("@langwatch/authz-browser-kit", () => ({
  ScopeChipPicker: () => null,
  ProviderScopeChips: () => null,
  ScopeFilter: () => null,
}));

vi.mock("../../blocks/permission-category-list.tsx", () => ({
  PermissionCounter: ({ count }: { count: number }) => <span data-testid="counter">{count}</span>,
  PermissionCategoryList: ({ selections }: { selections: Record<string, string> }) => (
    <pre data-testid="selections">{JSON.stringify(selections)}</pre>
  ),
}));

type Props = ComponentProps<typeof EditApiKeyDrawer>;

function keyRow(
  overrides: Partial<NonNullable<Props["apiKey"]>> = {},
): NonNullable<Props["apiKey"]> {
  return {
    id: "key-1",
    lookupIdPrefix: "ab12c",
    name: "CI Pipeline",
    description: "old words",
    permissionMode: "all",
    userId: null,
    userName: null,
    userEmail: null,
    createdByUserId: "user-1",
    createdByUserName: "Dev",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdByDeviceLabel: null,
    roleBindings: [
      {
        id: "rb-1",
        role: "ADMIN",
        customRoleId: null,
        customRoleName: null,
        customRolePermissions: null,
        scopeType: "PROJECT",
        scopeId: "proj-1",
        scopeName: "Web App",
      },
    ],
    ...overrides,
  };
}

function renderDrawer(apiKey: Props["apiKey"]) {
  const onSave = vi.fn<Props["onSave"]>();
  renderWithApiKeyHost(
    <EditApiKeyDrawer
      apiKey={apiKey}
      isUpdating={false}
      myBindings={{
        data: [
          {
            id: "rb-mine",
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
            role: "ADMIN",
            customRoleId: null,
            scopeName: "ACME",
            customRoleName: null,
          },
        ],
        isLoading: false,
      }}
      orgProjects={[{ id: "proj-1", name: "Web App", teamId: "team-1" }]}
      orgTeams={[{ id: "team-1", name: "Platform" }]}
      organizationId="org-1"
      organizationName="ACME"
      currentTeamId="team-1"
      currentProjectId="proj-1"
      onClose={() => void 0}
      onSave={onSave}
    />,
  );
  return onSave;
}

const save = () => screen.getByRole("button", { name: "Save" });

afterEach(() => cleanup());

describe("given a service key with all permissions", () => {
  describe("when it is saved unchanged", () => {
    it("sends no name or description and re-derives the bindings", async () => {
      const onSave = renderDrawer(keyRow());
      await userEvent.setup().click(save());
      expect(onSave.mock.calls).toEqual([
        [
          {
            apiKeyId: "key-1",
            name: undefined,
            description: undefined,
            permissionMode: "all",
            scopeType: "PROJECT",
            scopeId: "proj-1",
            permissions: undefined,
            bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "proj-1" }],
          },
        ],
      ]);
    });
  });

  describe("when the name changes and the description is emptied", () => {
    it("sends the new name and a null description", async () => {
      const user = userEvent.setup();
      const onSave = renderDrawer(keyRow());
      const [nameInput] = screen.getAllByRole("textbox");
      await user.clear(nameInput!);
      await user.type(nameInput!, "Renamed");
      await user.clear(screen.getByDisplayValue("old words"));
      await user.click(save());
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({ name: "Renamed", description: null });
    });
  });

  describe("when restricted is chosen with nothing selected", () => {
    it("preselects every category at its highest level and sends those permissions", async () => {
      const onSave = renderDrawer(keyRow());
      fireEvent.click(screen.getByText("Restricted"));
      const selections = JSON.parse((await screen.findByTestId("selections")).textContent ?? "{}");
      expect(Object.keys(selections).length).toBeGreaterThan(0);
      expect(Object.values(selections)).not.toContain("none");
      await userEvent.setup().click(save());
      const sent = onSave.mock.calls[0]?.[0];
      expect(sent?.permissionMode).toBe("restricted");
      expect(sent?.permissions?.length).toBeGreaterThan(0);
      expect(sent?.bindings).toEqual([{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "proj-1" }]);
      expect(selections).toMatchInlineSnapshot(`
        {
          "agentCache": "write",
          "analytics": "write",
          "annotations": "write",
          "auditLog": "read",
          "cost": "read",
          "datasets": "write",
          "evaluations": "write",
          "experiments": "write",
          "featureFlags": "write",
          "gateway": "write",
          "governance": "write",
          "langy": "write",
          "organization": "write",
          "playground": "write",
          "project": "write",
          "prompts": "write",
          "scenarios": "write",
          "secrets": "write",
          "team": "write",
          "traces": "write",
          "triggers": "write",
          "workflows": "write",
        }
      `);
    });
  });
});
