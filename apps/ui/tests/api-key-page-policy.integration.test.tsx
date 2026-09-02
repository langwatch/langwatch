/**
 * @vitest-environment jsdom
 *
 * What the three addresses this change serves are actually behind, proved by
 * mounting them.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice a
 * loader that names the wrong grant — the failure that refuses a reader the
 * platform page admitted, or admits one it refused. So this file loads the real
 * loaders, mounts what they hand back under a session that answers precisely,
 * and reads the result.
 *
 * THE ASSERTION MOST OF THIS FILE MAKES IS AN ABSENCE, and it is deliberate.
 * None of these three keys carried a page-level grant or a flag in
 * `platform/app`: the two settings pages were `SettingsLayout` and nothing else,
 * deciding inline what a reader may DO; `/cli/auth` had no guard because it does
 * its own session redirect, which a permission guard would pre-empt. Inventing
 * one here would refuse readers the product admits today. The refusals are
 * asserted in BOTH directions, which is what turns "we did not add a guard" into
 * a decision somebody can disagree with.
 *
 * Specs: specs/api-keys/unified-api-keys.feature,
 *        specs/secrets/secrets-manager.feature,
 *        specs/ai-governance/cli-onboarding/login-unified.feature
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
} from "../src/behavior/ui-capabilities";
import { apiKeyPageLoaders } from "../src/features/api-key";
import { CLI_AUTH_DOCUMENT_TITLE } from "../src/features/api-key/ui/sections/api-key-routes";
import { secretPageLoaders } from "../src/features/secret";

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

const LOADERS = { ...apiKeyPageLoaders, ...secretPageLoaders };

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = LOADERS[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
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
      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
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
      expect(screen.queryByRole("link", { name: "General Settings" })).toBeNull();
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
    expect(Object.keys(apiKeyPageLoaders).sort()).toEqual([CLI_AUTH_KEY, API_KEYS_KEY]);
    expect(Object.keys(secretPageLoaders)).toEqual([SECRETS_KEY]);
  });
});
