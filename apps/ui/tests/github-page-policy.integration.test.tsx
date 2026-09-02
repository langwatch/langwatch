/**
 * @vitest-environment jsdom
 *
 * What `/settings/integrations` is actually behind, proved by mounting it.
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
 * Spec: specs/integrations/github-connection.feature
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

vi.mock("@langwatch/github-web/screens/integrations", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/github-web/screens/integrations")
  >("@langwatch/github-web/screens/integrations");
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
import { githubPageLoaders } from "../src/features/github";

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

async function openIntegrations(permissions: readonly string[]): Promise<void> {
  const loader = githubPageLoaders[INTEGRATIONS_KEY];
  if (!loader) throw new Error(`no loader is registered for ${INTEGRATIONS_KEY}`);
  const Mounted = (await loader()).default;
  render(
    <ChakraProvider value={defaultSystem}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/settings/integrations"]}>
          <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
            <Mounted />
          </UiCapabilityContextProvider>
        </MemoryRouter>
      </QueryClientProvider>
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

      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
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

      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring administrator grant instead", () => {
    it("is still refused", async () => {
      await openIntegrations(["project:manage"]);

      expect(screen.queryByText("the integrations page")).toBeNull();
    });
  });
});
