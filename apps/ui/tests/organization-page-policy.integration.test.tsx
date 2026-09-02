/**
 * @vitest-environment jsdom
 *
 * What the two identity settings addresses this application now serves are
 * actually behind, proved by mounting them.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice
 * a loader that names the wrong grant — the failure that refuses a reader the
 * platform page admitted, or admits one it refused. So this file loads the real
 * loaders, mounts what they hand back under a session that answers precisely,
 * and reads the result.
 *
 * THE TWO KEYS HAVE OPPOSITE POLICIES, one for one with the platform pages, and
 * asserting them together is the point:
 *
 * - `/settings/audit-log` was `withPermissionGuard("organization:manage")`. The
 *   audit trail names who did what from every address in the organization, so
 *   it is an administrator's surface.
 * - `/settings/authentication` carried NO guard of any kind. Everything on it
 *   is keyed on the reader's own account, so there is no scope to hold a grant
 *   over — and refusing a member their own sign-in methods would lock them out
 *   of changing their own password.
 *
 * The PLAN gate on the audit trail is deliberately not a guard: a reader below
 * Enterprise gets the page and a straight answer about what it would show,
 * which is asserted in `@langwatch/organization-web`'s own suite.
 *
 * Spec: specs/audit-log/audit-log.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiNode } = vi.hoisted(() => {
  const emptyQuery = { data: undefined, isLoading: false, isSuccess: false };
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          return node();
        },
      },
    );
  return { apiNode: node };
});

vi.mock("@langwatch/organization-web/screens/organization", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/organization-web/screens/organization")
  >("@langwatch/organization-web/screens/organization");
  const Screen = () => <div>the audit log page</div>;
  return {
    ...actual,
    organizationApi: apiNode(),
    organizationScreens: { auditLog: async () => ({ default: Screen }) },
  };
});

vi.mock("@langwatch/user-web/screens/personal-workspace", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/user-web/screens/personal-workspace")
  >("@langwatch/user-web/screens/personal-workspace");
  const Screen = () => <div>the authentication page</div>;
  return {
    ...actual,
    personalWorkspaceApi: apiNode(),
    personalWorkspaceScreens: { authentication: async () => ({ default: Screen }) },
  };
});

// The harvested settings chrome reads the plan and the membership role over the
// application's transport, neither of which is what this file is about.
vi.mock("../src/behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: false,
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
import type { UiPageLoaderRegistry } from "../src/behavior/ui-page-loaders";
import { organizationPageLoaders } from "../src/features/organization";
import { personalWorkspacePageLoaders } from "../src/features/personal-workspace";

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

async function openPage(
  loaders: UiPageLoaderRegistry,
  key: string,
  permissions: readonly string[],
): Promise<void> {
  const loader = loaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
  render(
    <ChakraProvider value={defaultSystem}>
      <QueryClientProvider client={new QueryClient()}>
        {/* The address the page is served at, so the settings menu opens the
            group that holds it — the same thing it does for a reader who
            navigated here. */}
        <MemoryRouter initialEntries={[key.replace(/^pages/, "")]}>
          <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
            <Mounted />
          </UiCapabilityContextProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ChakraProvider>,
  );
}

const AUDIT_LOG_KEY = "pages/settings/audit-log";
const AUTHENTICATION_KEY = "pages/settings/authentication";

afterEach(cleanup);

describe("given the audit log page", () => {
  describe("when the reader may manage the organization", () => {
    /** @scenario Only an organization administrator may open the audit trail */
    it("opens", async () => {
      await openPage(organizationPageLoaders, AUDIT_LOG_KEY, ["organization:manage"]);

      expect(screen.getByText("the audit log page")).toBeDefined();
    });

    it("renders inside the settings chrome", async () => {
      await openPage(organizationPageLoaders, AUDIT_LOG_KEY, ["organization:manage"]);

      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
    });
  });

  describe("when the reader may only view the organization", () => {
    /**
     * The grant that separates a member from an administrator here, and the one
     * a sabotage would swap. `organization:view` is what every member of every
     * organization holds.
     */
    /** @scenario Only an organization administrator may open the audit trail */
    it("is refused, and named the grant it needs", async () => {
      await openPage(organizationPageLoaders, AUDIT_LOG_KEY, ["organization:view"]);

      expect(screen.queryByText("the audit log page")).toBeNull();
      expect(screen.getByText(/organization:manage/)).toBeDefined();
    });

    it("still frames the refusal in the settings chrome", async () => {
      await openPage(organizationPageLoaders, AUDIT_LOG_KEY, ["organization:view"]);

      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring administrator grant instead", () => {
    it("is still refused", async () => {
      await openPage(organizationPageLoaders, AUDIT_LOG_KEY, ["project:manage"]);

      expect(screen.queryByText("the audit log page")).toBeNull();
    });
  });
});

describe("given the sign-in methods page", () => {
  describe("when the reader holds nothing at all", () => {
    /**
     * The OPPOSITE assertion to the one above, and it has to be made: a page
     * about the reader's own credentials that could be refused would leave a
     * member with no way to change their own password.
     */
    /** @scenario Every signed-in reader can open their own sign-in methods */
    it("opens anyway, because it is about their own account", async () => {
      await openPage(personalWorkspacePageLoaders, AUTHENTICATION_KEY, []);

      expect(screen.getByText("the authentication page")).toBeDefined();
    });

    /** @scenario Every signed-in reader can open their own sign-in methods */
    it("renders inside the settings chrome", async () => {
      await openPage(personalWorkspacePageLoaders, AUTHENTICATION_KEY, []);

      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
    });
  });
});
