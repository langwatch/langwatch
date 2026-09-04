/**
 * @vitest-environment jsdom
 *
 * What `/settings/integrations` is actually behind, proved by mounting it
 * under the real chrome.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice
 * a loader that names the wrong grant — the failure that refuses a reader the
 * platform page admitted, or admits one it refused. So this file loads the real
 * loader, mounts what it hands back under a session that answers precisely, and
 * reads the result.
 *
 * THE GRANT IS `organization:manage`, one for one with the platform page's
 * `withPermissionGuard("organization:manage", { layoutComponent: SettingsLayout })`.
 * It is the administrator's grant on purpose: the spec lets any member LEARN
 * that a connection exists, but starting or removing an installation changes
 * what LangWatch can write to on the organization's repositories.
 *
 * THE CHROME IS `NavigationShell` NOW, MOUNTED HERE — see
 * `settings-family-page-policy.integration.test.tsx` for why: this
 * application's own settings layout, which drew a duplicate of
 * `NavigationShell`'s own sidebar, is deleted.
 *
 * Spec: specs/integrations/github-connection.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { navigationApi } from "@langwatch/navigation-web/screens/landing";
import { NavigationShell } from "@langwatch/navigation-web/chrome";
import {
  WithStubNavigationHost,
  type StubNavigationReadings,
} from "@langwatch/navigation-web/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiFeatureApiClient } from "../src/behavior/ui-feature-transport";

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

vi.mock("@langwatch/github-web/screens/integrations", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/github-web/screens/integrations")>(
    "@langwatch/github-web/screens/integrations",
  );
  const Screen = () => <div>the integrations page</div>;
  return {
    ...actual,
    githubApi: apiNode(),
    githubScreens: { integrations: async () => ({ default: Screen }) },
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
import { githubFeature } from "../src/features/github";

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

const INTEGRATIONS_KEY = "pages/settings/integrations";

/** A desktop viewport: `NavigationShell` draws phone chrome with none. */
function useDesktopViewport() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => void 0,
    removeEventListener: () => void 0,
    addListener: () => void 0,
    removeListener: () => void 0,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function ShellTransport({ children }: { children: React.ReactNode }) {
  useDesktopViewport();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [client] = useState(() => createUiFeatureApiClient());
  return (
    <QueryClientProvider client={queryClient}>
      <navigationApi.Provider client={client} queryClient={queryClient}>
        {children}
      </navigationApi.Provider>
    </QueryClientProvider>
  );
}

const SHELL_TEAM = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects: [{ id: "project_1", slug: "demo", name: "Demo", isPersonal: false }],
};
const SHELL_ORGANIZATION = { id: "org_1", name: "ACME", teams: [SHELL_TEAM] };
const SHELL_READINGS: StubNavigationReadings = {
  organizations: [SHELL_ORGANIZATION],
  organization: SHELL_ORGANIZATION,
  team: SHELL_TEAM,
  project: SHELL_TEAM.projects[0],
  currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
  isLoading: false,
  pathname: "/settings/integrations",
  permissions: ["organization:view"],
};

async function openIntegrations(permissions: readonly string[]): Promise<void> {
  const loader = githubFeature.loaders[INTEGRATIONS_KEY];
  if (!loader) throw new Error(`no loader is registered for ${INTEGRATIONS_KEY}`);
  const Mounted = (await loader()).default;
  render(
    <ChakraProvider value={defaultSystem}>
      <ShellTransport>
        <WithStubNavigationHost readings={{ ...SHELL_READINGS }}>
          <MemoryRouter initialEntries={["/settings/integrations"]}>
            <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
              <NavigationShell>
                <Mounted />
              </NavigationShell>
            </UiCapabilityContextProvider>
          </MemoryRouter>
        </WithStubNavigationHost>
      </ShellTransport>
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given the integrations page", () => {
  describe("when the reader may manage the organization", () => {
    /** @scenario Starting an installation requires organization management */
    it("opens", async () => {
      await openIntegrations(["organization:manage"]);

      expect(screen.getByText("the integrations page")).toBeDefined();
    });

    it("renders inside the settings chrome", async () => {
      await openIntegrations(["organization:manage"]);

      expect(screen.getByRole("link", { name: "General" })).toBeDefined();
    });
  });

  describe("when the reader may only view the organization", () => {
    /**
     * The grant that separates a member from an administrator here, and the one
     * a sabotage would swap. `organization:view` is what every member of every
     * organization holds.
     */
    /** @scenario Starting an installation requires organization management */
    it("is refused, and named the grant it needs", async () => {
      await openIntegrations(["organization:view"]);

      expect(screen.queryByText("the integrations page")).toBeNull();
      expect(screen.getByText(/organization:manage/)).toBeDefined();
    });

    it("still frames the refusal in the settings chrome", async () => {
      await openIntegrations(["organization:view"]);

      expect(screen.getByRole("link", { name: "General" })).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring administrator grant instead", () => {
    it("is still refused", async () => {
      await openIntegrations(["project:manage"]);

      expect(screen.queryByText("the integrations page")).toBeNull();
    });
  });
});
