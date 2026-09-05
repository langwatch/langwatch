/**
 * What the three addresses this change serves are actually behind, proved by mounting
 * them.
 * @vitest-environment jsdom
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

vi.mock("@langwatch/api-key-web/screens/api-key", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/api-key-web/screens/api-key")>(
    "@langwatch/api-key-web/screens/api-key",
  );
  return {
    ...actual,
    apiKeyApi: apiNode(),
    apiKeyScreens: {
      apiKeys: async () => ({ default: () => <div>the api keys page</div> }),
      cliAuth: async () => ({ default: () => <div>the cli authorize page</div> }),
    },
  };
});

vi.mock("@langwatch/secret-web/screens/secret", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/secret-web/screens/secret")>(
    "@langwatch/secret-web/screens/secret",
  );
  return {
    ...actual,
    secretApi: apiNode(),
    secretScreens: {
      secrets: async () => ({ default: () => <div>the secrets page</div> }),
    },
  };
});

// The harvested settings chrome reads the plan and the membership role over the
// application's transport. Neither is what this file is about.
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
} from "@langwatch/ui-host/capabilities";
import { apiKeyFeature } from "../src/features/api-key";
import { CLI_AUTH_DOCUMENT_TITLE } from "../src/features/api-key/ui/sections/api-key-routes";
import { secretFeature } from "../src/features/secret";

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

const documentTarget = { title: "" };

function capabilities(session: UiSessionPort): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create(documentTarget),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session,
  };
}

const LOADERS = { ...apiKeyFeature.loaders, ...secretFeature.loaders };

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

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = LOADERS[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
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

const API_KEYS_KEY = "pages/settings/api-keys";
const SECRETS_KEY = "pages/settings/secrets";
const CLI_AUTH_KEY = "pages/cli/auth";

afterEach(() => {
  cleanup();
  documentTarget.title = "";
});

describe.each([
  [API_KEYS_KEY, /the api keys page/],
  [SECRETS_KEY, /the secrets page/],
])("given the settings key %s", (key, body) => {
  describe("when a reader arrives holding nothing but the grant every member inherits", () => {
    /** @scenario A member sees the page and not the write controls */
    it("opens, because the page decides what a reader may DO rather than whether they may look", async () => {
      await openPage(key, ["organization:view"]);
      expect(screen.getByText(body)).toBeDefined();
    });
  });

  describe("when a reader arrives holding no grant at all", () => {
    /** @scenario A member sees the page and not the write controls */
    it("still opens: neither platform page carried a page-level grant", async () => {
      await openPage(key, []);
      expect(screen.getByText(body)).toBeDefined();
    });
  });

  describe("when the page renders", () => {
    /** @scenario No page the Settings menu opens is left without it */
    it("frames itself in the settings chrome, with the menu the reader navigated by", async () => {
      await openPage(key, ["organization:view"]);
      expect(screen.getByRole("link", { name: "General" })).toBeDefined();
    });
  });
});

describe("given the CLI authorize key", () => {
  describe("when a reader arrives from their terminal", () => {
    /** @scenario the screen asks for the code check first */
    it("opens with no grant at all, because the page does its own session redirect", async () => {
      await openPage(CLI_AUTH_KEY, []);
      expect(screen.getByText(/the cli authorize page/)).toBeDefined();
    });

    /** @scenario the screen asks for the code check first */
    it("is NOT framed in the settings chrome, because it is not a settings page", async () => {
      await openPage(CLI_AUTH_KEY, []);
      expect(screen.queryByRole("link", { name: "General" })).toBeNull();
    });

    /** @scenario the screen asks for the code check first */
    it("names itself in the browser tab", async () => {
      await openPage(CLI_AUTH_KEY, []);
      expect(documentTarget.title).toBe(CLI_AUTH_DOCUMENT_TITLE);
    });
  });
});

describe("given the three keys this change serves", () => {
  /** @scenario Every key the family claims is served by it */
  it("registers each of them exactly once, and nothing else", () => {
    expect(Object.keys(apiKeyFeature.loaders).sort()).toEqual([CLI_AUTH_KEY, API_KEYS_KEY]);
    expect(Object.keys(secretFeature.loaders)).toEqual([SECRETS_KEY]);
  });
});
