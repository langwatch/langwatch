/**
 * @vitest-environment jsdom
 * The create and edit drawers with the real scope picker: the quick picks name the
 * current team and project, and select the scope the key has.
 * Spec: specs/api-keys/scope-based-permissions.feature
 */

import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApiKeyHost } from "../../../testing.tsx";
import { CreateApiKeyDrawer } from "../create-api-key-drawer.tsx";
import { EditApiKeyDrawer } from "../edit-api-key-drawer.tsx";

vi.mock("../../../behavior/use-grantable-permissions.ts", async () => {
  const { fakeGrantableHook } = await import("./support/fake-grantable.ts");
  return {
    useGrantablePermissions: fakeGrantableHook({
      bindings: () => [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }],
    }),
  };
});

vi.mock("../../../behavior/api-key-api.ts", () => ({
  apiKeyApi: { apiKey: { orgMembers: { useQuery: () => ({ data: [], isLoading: false }) } } },
}));

vi.mock("@langwatch/design-system/provider-scope-chips", () => ({
  ProviderScopeChips: () => null,
}));

vi.mock("../../blocks/permission-category-list.tsx", () => ({
  PermissionCounter: () => null,
  PermissionCategoryList: () => null,
}));

const SCOPE_PROPS = {
  orgProjects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
  orgTeams: [{ id: "team-1", name: "Platform" }],
  organizationId: "org-1",
  organizationName: "ACME",
  currentTeamId: "team-1",
  currentProjectId: "proj-1",
  onClose: () => void 0,
};
const MY_BINDINGS = {
  data: [
    {
      id: "rb-mine",
      scopeType: "ORGANIZATION" as const,
      scopeId: "org-1",
      role: "ADMIN" as const,
      customRoleId: null,
      scopeName: "ACME",
      customRoleName: null,
    },
  ],
  isLoading: false,
  isError: false,
};

const pick = (scope: "organization" | "team" | "project" | "multiple") =>
  screen.getByTestId(`quick-scope-${scope}`);

/** Opened by a click, as the page does: the drawer mounts closed and resets on open. */
async function openCreate() {
  function Page() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Create new secret key
        </button>
        <CreateApiKeyDrawer
          {...SCOPE_PROPS}
          isOpen={open}
          isCreating={false}
          myBindings={{ ...MY_BINDINGS, refetch: () => Promise.resolve() }}
          onCreate={() => void 0}
        />
      </>
    );
  }
  renderWithApiKeyHost(<Page />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Create new secret key" }));
  await screen.findByTestId("quick-scope-project");
}

type EditKey = NonNullable<ComponentProps<typeof EditApiKeyDrawer>["apiKey"]>;

function teamScopedKey(): EditKey {
  return {
    id: "key-1",
    lookupIdPrefix: "ab12c",
    name: "CI Pipeline",
    description: null,
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
    grants: [
      {
        id: "rb-1",
        role: "ADMIN",
        customRoleId: null,
        customRoleName: null,
        customRolePermissions: null,
        scopeType: "TEAM",
        scopeId: "team-1",
        scopeName: "Platform",
      },
    ],
  };
}

afterEach(() => cleanup());

describe("given the create API key drawer opens in a project", () => {
  /** @scenario Scope quick-picks show Organization, Team, Project, Multiple */
  it("offers the four quick picks, naming the current team and project, each with an icon", async () => {
    await openCreate();

    expect(pick("organization")).toHaveTextContent("Organization");
    expect(pick("team")).toHaveTextContent(/^Team Platform$/);
    expect(pick("project")).toHaveTextContent(/^Project Web App$/);
    expect(within(pick("team")).getByTestId("scope-name-badge")).toHaveTextContent(/^Platform$/);
    expect(within(pick("project")).getByTestId("scope-name-badge")).toHaveTextContent(/^Web App$/);
    expect(pick("multiple")).toHaveTextContent("Multiple");
    for (const scope of ["organization", "team", "project"] as const) {
      expect(pick(scope).querySelector("svg")).not.toBeNull();
    }
  });

  /** @scenario Scope defaults to current project via quick-pick pill */
  it("selects the current project's pick by default", async () => {
    await openCreate();

    expect(pick("project")).toHaveAttribute("aria-pressed", "true");
    expect(pick("team")).toHaveAttribute("aria-pressed", "false");
  });

  /** @scenario The Advanced summary names the key's scope in a badge */
  it("names the current project in a badge under the picker and in the Advanced summary", async () => {
    await openCreate();

    const helper = screen.getByTestId("scope-summary");
    expect(helper).toHaveTextContent(/^Only Web App can use this configuration\.$/);
    expect(within(helper).getByTestId("scope-name-badge")).toHaveTextContent(/^Web App$/);
    const summary = screen.getByTestId("api-key-advanced-summary");
    expect(summary).toHaveTextContent(/^Personal key with all permissions on Web App\.$/);
    expect(within(summary).getByTestId("scope-name-badge")).toHaveTextContent(/^Web App$/);
  });
});

describe("given the edit drawer opens on a team-scoped key", () => {
  /** @scenario Edit drawer pre-populates scope from existing binding */
  it("selects the named team pick", async () => {
    function Page() {
      const [apiKey, setApiKey] = useState<EditKey | null>(null);
      return (
        <>
          <button type="button" onClick={() => setApiKey(teamScopedKey())}>
            Edit
          </button>
          <EditApiKeyDrawer
            {...SCOPE_PROPS}
            apiKey={apiKey}
            isUpdating={false}
            myBindings={MY_BINDINGS}
            onSave={() => void 0}
          />
        </>
      );
    }
    renderWithApiKeyHost(<Page />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("quick-scope-team");

    expect(pick("team")).toHaveTextContent(/^Team Platform$/);
    expect(pick("team")).toHaveAttribute("aria-pressed", "true");
  });
});
