/**
 * @vitest-environment jsdom
 * The Roles & access page is an administration surface, opened through the
 * guard the installed module's own declaration puts in front of it.
 * Spec: specs/rbac/custom-role-permission-editing.feature
 */

import type { UiActor } from "@langwatch/browser-host/capabilities";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => {
  const mutation = () => ({ useMutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn() }) });
  const api = {
    useUtils: () => ({
      role: { getAll: { invalidate: vi.fn() } },
      authz: { listManagedGrants: { invalidate: vi.fn() } },
    }),
    authz: {
      listManagedGrants: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
    },
    role: {
      getAll: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
      create: mutation(),
      update: mutation(),
      delete: mutation(),
    },
  };

  return { api };
});

vi.mock("../behavior/authz-api.ts", () => ({ authzApi: api }));

// Isolation is off: reload so the screen binds this file's mock, not a sibling suite's.
vi.resetModules();
const { UiCapabilityContextProvider, UiSession } =
  await import("@langwatch/browser-host/capabilities");
const { createUiCapabilitiesFromHost } = await import("@langwatch/browser-host/testing");
const { renderWithDesignSystem } = await import("@langwatch/design-system/testing");
const { installedModuleScreens } = await import("@langwatch/browser/module-screens");
const { authzWeb } = await import("../authz.web.ts");
const { AuthzHostProvider } = await import("../model/authz-host.ts");
const { FakeAuthzHost } = await import("../testing.tsx");

const ROLES_PAGE = "pages/settings/roles";

class Reader extends UiSession {
  constructor(private readonly grants: readonly string[]) {
    super();
  }

  currentUser(): UiActor | null {
    return null;
  }

  hasPermission(permission: string): boolean {
    return this.grants.includes(permission);
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return true;
  }
}

/** Opens the roles page the way the router does: the installed module's loader, then render. */
async function openRolesPage(grants: readonly string[]) {
  const load = installedModuleScreens([authzWeb]).loaders[ROLES_PAGE];
  if (!load) throw new Error("authz installs no roles page");
  const { default: Page } = await load();

  return renderWithDesignSystem(
    <UiCapabilityContextProvider
      value={createUiCapabilitiesFromHost(
        { route: () => ({ params: {}, query: {} }), navigate: () => {} },
        new Reader(grants),
      )}
    >
      <AuthzHostProvider value={new FakeAuthzHost()}>
        <Page />
      </AuthzHostProvider>
    </UiCapabilityContextProvider>,
  );
}

describe("the Roles & access page", () => {
  describe("given a reader who may manage the organization", () => {
    /** @scenario Only an organization manager reaches the RBAC pages */
    it("opens, framed in the settings chrome", async () => {
      await openRolesPage(["organization:manage", "organization:view"]);

      expect(await screen.findByText("Admin")).toBeInTheDocument();
      expect(screen.queryByText("Access Restricted")).not.toBeInTheDocument();
      expect(authzWeb.installation.screens[ROLES_PAGE]).toMatchObject({
        path: "/settings/roles",
        within: "settings",
      });
    });
  });

  describe("given a reader who may only view the organization", () => {
    /** @scenario A member is refused the RBAC pages */
    it("is refused, naming the grant the page needs, and the page stays in the settings chrome", async () => {
      await openRolesPage(["organization:view"]);

      expect(await screen.findByText("Access Restricted")).toBeInTheDocument();
      expect(screen.getByText("Missing permission: organization:manage")).toBeInTheDocument();
      expect(screen.queryByText("Admin")).not.toBeInTheDocument();
      expect(authzWeb.installation.screens[ROLES_PAGE]).toMatchObject({
        requires: "organization:manage",
        within: "settings",
      });
    });
  });
});
