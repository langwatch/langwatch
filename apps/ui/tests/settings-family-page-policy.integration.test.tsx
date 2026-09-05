/**
 * What the thirteen settings addresses are actually behind, proved by mounting them under the real chrome.
 * @vitest-environment jsdom
 * Spec: specs/settings/settings-page-chrome.feature
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

const { apiNode, screenFor } = vi.hoisted(() => {
  const emptyQuery = { data: void 0, isLoading: false, isSuccess: false, error: null };
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation")
            return () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false });
          if (property === "useUtils") return () => node();
          if (property === "invalidate") return async () => {};
          return node();
        },
      },
    );
  const screenFor = (label: string) => async () => ({
    default: () => <div>{label}</div>,
  });
  return { apiNode: node, screenFor };
});

vi.mock("@langwatch/topic-web/screens/topic-clustering", () => ({
  topicApi: apiNode(),
  topicScreens: { topicClustering: screenFor("the topic clustering page") },
  TopicHostPort: class {},
  TopicHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/notification-web/screens/email-suppressions", () => ({
  notificationApi: apiNode(),
  notificationScreens: { emailSuppressions: screenFor("the email suppressions page") },
  NotificationHostPort: class {},
  NotificationHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/enterprise-licensing-web/screens/licensing", () => ({
  licensingApi: apiNode(),
  licensingScreens: { license: screenFor("the license page") },
  LicensingHostPort: class {},
  LicensingHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/enterprise-billing-web/screens/billing", () => ({
  billingApi: apiNode(),
  billingScreens: {
    plans: screenFor("the plans page"),
    subscription: screenFor("the subscription page"),
    usage: screenFor("the usage page"),
  },
  BillingHostPort: class {},
  BillingHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/enterprise-scim-web/screens/scim", () => ({
  scimApi: apiNode(),
  scimScreens: { scim: screenFor("the scim page") },
  ScimHostPort: class {},
  ScimHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/annotation-web/screens/annotation-scores", () => ({
  annotationScoresApi: apiNode(),
  annotationScoresScreens: { annotationScores: screenFor("the annotation scores page") },
  AnnotationScoreDrawer: () => null,
  AnnotationScoresHostPort: class {},
  AnnotationScoresHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/project-web/screens/project-settings", () => ({
  projectApi: apiNode(),
  projectScreens: { projectSettings: screenFor("the general settings page") },
  ProjectHostPort: class {},
  ProjectHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/organization-web/screens/organization", () => ({
  organizationApi: apiNode(),
  organizationScreens: {
    auditLog: screenFor("the audit log page"),
    groups: screenFor("the groups page"),
    members: screenFor("the members page"),
    teams: screenFor("the teams page"),
    teamDetail: screenFor("the team detail page"),
  },
  OrganizationHostPort: class {},
  OrganizationHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The harvested settings chrome reads the plan and the membership role over the
// application's transport, neither of which is what this file is about.
vi.mock("../src/behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: true,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
  useUiPlatformAdmin: () => false,
}));

import type { ReactNode } from "react";
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
import { annotationScoresFeature } from "../src/features/annotation-scores";
import { billingFeature } from "../src/features/billing";
import { licensingFeature } from "../src/features/licensing";
import { notificationFeature } from "../src/features/notification";
import { organizationFeature } from "../src/features/organization";
import { projectFeature } from "../src/features/project";
import { scimFeature } from "../src/features/scim";
import { topicFeature } from "../src/features/topic";

class SilentNavigation extends UiNavigationPort {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoutePort {
  reading() {
    return { params: { team: "team_1" }, query: {} };
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

/** Every settings key that left `platform/app` in this move, with its family. */
const SETTINGS_LOADERS: UiPageLoaderRegistry = {
  ...annotationScoresFeature.loaders,
  ...billingFeature.loaders,
  ...licensingFeature.loaders,
  ...notificationFeature.loaders,
  ...organizationFeature.loaders,
  ...projectFeature.loaders,
  ...scimFeature.loaders,
  ...topicFeature.loaders,
};

/**
 * A desktop viewport, because jsdom does not implement `matchMedia` at all.
 */
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

/** The Providers `NavigationShell`'s own reads (the top bar's badges, usage) run on. */
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
  pathname: "/settings",
  permissions: ["organization:view"],
};

/**
 * Mounts what the loader hands back the way `UiAppChrome` actually does: inside
 * `NavigationShell`, which draws the settings sidebar for this pathname on its own. A
 * page that also drew one used to nest a second inside it.
 */
async function open(pageKey: string, permissions: readonly string[]): Promise<void> {
  const loader = SETTINGS_LOADERS[pageKey];
  if (!loader) throw new Error(`no loader is registered for ${pageKey}`);
  const Mounted = (await loader()).default as () => ReactNode;
  render(
    <ChakraProvider value={defaultSystem}>
      <ShellTransport>
        <WithStubNavigationHost readings={{ ...SHELL_READINGS }}>
          <MemoryRouter initialEntries={["/settings"]}>
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

/**
 * How many settings sidebars framed whatever the loader handed back. Exactly
 * one is "framed"; zero is bare; two or more is the duplicate-sidebar bug
 * this file used to be blind to, because it only ever mounted the page.
 */
function settingsSidebarCount(): number {
  return screen.queryAllByRole("link", { name: "General" }).length;
}

afterEach(cleanup);

/**
 * Everything a reader could hold, so the chrome case below is about the frame
 * and nothing else. The refusal cases name their grants one at a time.
 */
const EVERY_GRANT = [
  "annotations:view",
  "cost:view",
  "organization:manage",
  "organization:view",
  "project:manage",
  "team:view",
  "triggers:view",
];

describe("the thirteen settings pages that moved", () => {
  describe("when the reader holds every grant", () => {
    /** @scenario No page the Settings menu opens is left without it */
    it.each(Object.keys(SETTINGS_LOADERS))("%s opens inside the settings chrome", async (key) => {
      await open(key, EVERY_GRANT);

      expect(settingsSidebarCount()).toBe(1);
    });
  });

  describe("when the reader may only view the organization", () => {
    /**
     * The post-merge RBAC closure, restated as a mount. These three pages list
     * every member, every team and every group of the organization, so a plain
     * member holding `organization:view` must be refused all three.
     */
    it.each([
      ["pages/settings/members", "the members page"],
      ["pages/settings/teams", "the teams page"],
      ["pages/settings/groups", "the groups page"],
    ])("%s is refused, and named the grant it needs", async (key, label) => {
      await open(key, ["organization:view"]);

      expect(screen.queryByText(label)).toBeNull();
      expect(screen.getByText(/organization:manage/)).toBeDefined();
    });

    it("still frames each refusal in the settings chrome", async () => {
      await open("pages/settings/members", ["organization:view"]);

      expect(settingsSidebarCount()).toBe(1);
    });
  });

  describe("when the reader may view the triggers of this project", () => {
    /** @scenario The email suppressions page keeps it */
    it("opens the email suppressions page inside the settings chrome", async () => {
      await open("pages/settings/email-suppressions", ["triggers:view"]);

      expect(screen.getByText("the email suppressions page")).toBeDefined();
      expect(settingsSidebarCount()).toBe(1);
    });
  });

  describe("when the reader may not view the triggers of this project", () => {
    it("refuses the email suppressions page", async () => {
      await open("pages/settings/email-suppressions", ["organization:manage"]);

      expect(screen.queryByText("the email suppressions page")).toBeNull();
      expect(screen.getByText(/triggers:view/)).toBeDefined();
    });
  });

  describe("when a page is behind no grant at all", () => {
    /**
     * License and subscription were unguarded on the platform side, and are kept that
     * way one for one: what a reader may DO on them is decided by the procedures behind
     * them, and hiding the page would hide the plan a reader is trying to buy.
     */
    it.each([
      ["pages/settings/license", "the license page"],
      ["pages/settings/subscription", "the subscription page"],
    ])("%s opens for a reader holding nothing", async (key, label) => {
      await open(key, []);

      expect(screen.getByText(label)).toBeDefined();
    });
  });
});
