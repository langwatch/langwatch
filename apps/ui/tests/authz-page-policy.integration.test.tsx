/**
 * @vitest-environment jsdom
 *
 * What the two RBAC addresses are actually behind, proved by mounting them.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice
 * a loader that names the wrong grant — the failure that refuses a reader the
 * platform page admitted, or admits one it refused. So this file loads the real
 * loaders, mounts what they hand back under a session that answers precisely,
 * and reads the result.
 *
 * THIS FILE INHERITS A REGRESSION PIN. `platform/app/src/pages/settings/__tests__/admin-page-guards.unit.test.ts`
 * read `roles.tsx` off disk to prove it required `organization:manage`, because
 * five legacy administration pages once guarded themselves on permissions a
 * MEMBER inherits and leaked full organization data to every member. The page
 * is no longer there to read, so the line is held here — by mounting, which is
 * strictly stronger than a source match.
 *
 * The screens are faked. What is under test is the policy the frontend feature
 * wraps them in, plus the settings chrome sitting OUTSIDE the guard, so a
 * refused reader still sees the settings frame they navigated into.
 *
 * Spec: specs/rbac/custom-role-permission-editing.feature
 * Spec: specs/rbac/role-binding-audit.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiNode } = vi.hoisted(() => {
  const emptyQuery = { data: undefined, isLoading: false };
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          if (property === "useUtils") return () => node();
          return node();
        },
      },
    );
  return { apiNode: node };
});

vi.mock("@langwatch/authz-web/screens/authz", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/authz-web/screens/authz")>(
    "@langwatch/authz-web/screens/authz",
  );
  return {
    ...actual,
    authzApi: apiNode(),
    authzScreens: {
      roles: async () => ({ default: () => <div>the roles page</div> }),
      roleBindings: async () => ({ default: () => <div>the role bindings page</div> }),
    },
  };
});

// The harvested settings chrome reads the plan and the membership role over the
// application's transport, and so does the AuthZ host. Neither is what this
// file is about; the plan gate itself is pinned in the package's own suites.
vi.mock("../src/behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: true,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
  useUiPlatformAdmin: () => false,
}));

import { MemoryRouter } from "react-router";
import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "../src/behavior/ui-capabilities";
import { authzPageLoaders } from "../src/features/authz";

class SilentNavigation extends UiNavigationPort {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoutePort {
  reading() {
    return { params: {}, query: {} };
  }
  setQuery(): void {}
}

class SilentFeedback extends UiFeedbackPort {
  succeeded(_: UiSuccessNotice): void {}
  failed(_: UiFailureNotice): void {}
}

class AnsweringSession extends UiSessionPort {
  constructor(private readonly permissions: readonly string[]) {
    super();
  }

  currentUser(): UiActor | null {
    return { id: "user_1", name: null, email: null, image: null };
  }

  activeScope(): UiActiveScope {
    return { organizationId: "org_1", projectId: "proj_1" };
  }

  hasPermission(permission: string): boolean {
    return this.permissions.includes(permission);
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return true;
  }
}

function capabilities(session: UiSessionPort): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session,
  };
}

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = authzPageLoaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
  // The address the page is served at, so the settings menu opens the group
  // that holds it — the same thing it does for a reader who navigated here.
  const pathname = key.replace(/^pages/, "");
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[pathname]}>
        <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
          <Mounted />
        </UiCapabilityContextProvider>
      </MemoryRouter>
    </ChakraProvider>,
  );
}

const ROLES_KEY = "pages/settings/roles";
const BINDINGS_KEY = "pages/settings/role-bindings";

afterEach(cleanup);

describe.each([
  [ROLES_KEY, /the roles page/],
  [BINDINGS_KEY, /the role bindings page/],
])("given %s", (key, body) => {
  describe("when the reader may manage the organization", () => {
    /** @scenario Only an organization manager reaches the RBAC pages */
    it("opens", async () => {
      await openPage(key, ["organization:manage"]);

      expect(screen.getByText(body)).toBeDefined();
    });

    it("renders inside the settings chrome, with the menu the reader navigated by", async () => {
      await openPage(key, ["organization:manage"]);

      expect(screen.getByRole("link", { name: "Roles & Permissions" })).toBeDefined();
      expect(screen.getByRole("link", { name: "Role Bindings" })).toBeDefined();
    });
  });

  describe("when the reader holds only the grant every member inherits", () => {
    /** @scenario A member is refused the RBAC pages */
    it("is refused, and named the grant it needs", async () => {
      // THE REGRESSION. `organization:view` is what MEMBER inherits, and the
      // page guarded on it once — which is how audit-grade RBAC data reached
      // every member of the organization.
      await openPage(key, ["organization:view"]);

      expect(screen.queryByText(body)).toBeNull();
      expect(screen.getByText(/organization:manage/)).toBeDefined();
    });

    it("still frames the refusal in the settings chrome", async () => {
      await openPage(key, ["organization:view"]);

      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring administrative grant", () => {
    it("is still refused, because the guard asks for a name", async () => {
      await openPage(key, ["auditLog:view", "team:manage"]);

      expect(screen.queryByText(body)).toBeNull();
    });
  });
});
