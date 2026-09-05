/**
 * @vitest-environment jsdom
 * Spec: specs/data-retention/retention-policy-configuration.feature
 * Spec: specs/data-privacy/policy-configuration.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { navigationApi } from "@langwatch/navigation-web/screens/navigation";
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
  const emptyQuery = { data: undefined, isLoading: false };
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

vi.mock("@langwatch/data-retention-web/screens/data-retention", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/data-retention-web/screens/data-retention")
  >("@langwatch/data-retention-web/screens/data-retention");
  const Screen = () => <div>the retention policies page</div>;
  return {
    ...actual,
    dataRetentionApi: apiNode(),
    dataRetentionScreens: { dataRetention: async () => ({ default: Screen }) },
  };
});

vi.mock("@langwatch/data-privacy-web/screens/data-privacy", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/data-privacy-web/screens/data-privacy")
  >("@langwatch/data-privacy-web/screens/data-privacy");
  const Screen = () => <div>the data privacy page</div>;
  return {
    ...actual,
    dataPrivacyApi: apiNode(),
    dataPrivacyScreens: { dataPrivacy: async () => ({ default: Screen }) },
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
} from "@langwatch/ui-host/capabilities";
import type { UiPageLoaderRegistry } from "../src/behavior/ui-page-loaders";
import { dataPrivacyFeature } from "../src/features/data-privacy";
import { dataRetentionFeature } from "../src/features/data-retention";

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

function shellReadings(pathname: string): StubNavigationReadings {
  return {
    organizations: [SHELL_ORGANIZATION],
    organization: SHELL_ORGANIZATION,
    team: SHELL_TEAM,
    project: SHELL_TEAM.projects[0],
    currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
    isLoading: false,
    pathname,
    permissions: ["organization:view"],
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
  // The address the page is served at, so the settings menu opens the group
  // that holds it — the same thing it does for a reader who navigated here.
  const pathname = key.replace(/^pages/, "");
  render(
    <ChakraProvider value={defaultSystem}>
      <ShellTransport>
        <WithStubNavigationHost readings={shellReadings(pathname)}>
          <MemoryRouter initialEntries={[pathname]}>
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

const RETENTION_KEY = "pages/settings/data-retention";
const PRIVACY_KEY = "pages/settings/data-privacy";

afterEach(cleanup);

describe("given the retention policies page", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage(dataRetentionFeature.loaders, RETENTION_KEY, ["project:view"]);

      expect(screen.getByText(/the retention policies page/)).toBeDefined();
    });

    it("renders inside the settings chrome, with the menu the reader navigated by", async () => {
      await openPage(dataRetentionFeature.loaders, RETENTION_KEY, ["project:view"]);

      expect(screen.getByRole("link", { name: "Data Retention" })).toBeDefined();
      expect(screen.getByRole("link", { name: "Data Privacy" })).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    it("is refused, and named the grant it needs", async () => {
      await openPage(dataRetentionFeature.loaders, RETENTION_KEY, ["triggers:view"]);

      expect(screen.queryByText(/the retention policies page/)).toBeNull();
      expect(screen.getByText(/project:view/)).toBeDefined();
    });

    it("still frames the refusal in the settings chrome", async () => {
      await openPage(dataRetentionFeature.loaders, RETENTION_KEY, ["triggers:view"]);

      expect(screen.getByRole("link", { name: "General" })).toBeDefined();
    });
  });

  describe("when the reader may update the project but the page asks to view it", () => {
    it("is still refused, because update does not imply view at this seam", async () => {
      // The hierarchy that makes `project:manage` satisfy `project:view` is
      // applied by the server when it answers the effective permission set, not
      // by the guard: the guard asks for a name and gets a yes or a no.
      await openPage(dataRetentionFeature.loaders, RETENTION_KEY, ["project:update"]);

      expect(screen.queryByText(/the retention policies page/)).toBeNull();
    });
  });
});

describe("given the data privacy page", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage(dataPrivacyFeature.loaders, PRIVACY_KEY, ["project:view"]);

      expect(screen.getByText(/the data privacy page/)).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    it("is refused, and named the grant it needs", async () => {
      await openPage(dataPrivacyFeature.loaders, PRIVACY_KEY, ["auditLog:view"]);

      expect(screen.queryByText(/the data privacy page/)).toBeNull();
      expect(screen.getByText(/project:view/)).toBeDefined();
    });
  });
});
