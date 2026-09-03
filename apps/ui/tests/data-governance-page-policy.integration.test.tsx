/**
 * @vitest-environment jsdom
 *
 * What the two data-governance addresses are actually behind, proved by
 * mounting them.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice a
 * loader that names the wrong grant — the failure that refuses a reader the
 * platform page admitted, or admits one it refused. So this file loads the real
 * loaders, mounts what they hand back under a session that answers precisely,
 * and reads the result.
 *
 * The screens are faked, and so is the transport their host providers read
 * over. What is under test is the policy the frontend features wrap the screens
 * in, plus one thing this family adds: the SETTINGS CHROME is inside the guard,
 * so a refused reader still sees the settings frame they navigated into. That
 * is what `withPermissionGuard({ layoutComponent: SettingsLayout })` did, and
 * it is the one wrapper this family carries over rather than drops.
 *
 * `project:view` is both platform pages' own grant, carried over one for one.
 * Neither page was behind a flag.
 *
 * Spec: specs/data-retention/retention-policy-configuration.feature
 * Spec: specs/data-privacy/policy-configuration.feature
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
} from "../src/behavior/ui-capabilities";
import type { UiPageLoaderRegistry } from "../src/behavior/ui-page-loaders";
import { dataPrivacyPageLoaders } from "../src/features/data-privacy";
import { dataRetentionPageLoaders } from "../src/features/data-retention";

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

const RETENTION_KEY = "pages/settings/data-retention";
const PRIVACY_KEY = "pages/settings/data-privacy";

afterEach(cleanup);

describe("given the retention policies page", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage(dataRetentionPageLoaders, RETENTION_KEY, ["project:view"]);

      expect(screen.getByText(/the retention policies page/)).toBeDefined();
    });

    it("renders inside the settings chrome, with the menu the reader navigated by", async () => {
      await openPage(dataRetentionPageLoaders, RETENTION_KEY, ["project:view"]);

      expect(screen.getByRole("link", { name: "Data Retention" })).toBeDefined();
      expect(screen.getByRole("link", { name: "Data Privacy" })).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    it("is refused, and named the grant it needs", async () => {
      await openPage(dataRetentionPageLoaders, RETENTION_KEY, ["triggers:view"]);

      expect(screen.queryByText(/the retention policies page/)).toBeNull();
      expect(screen.getByText(/project:view/)).toBeDefined();
    });

    it("still frames the refusal in the settings chrome", async () => {
      await openPage(dataRetentionPageLoaders, RETENTION_KEY, ["triggers:view"]);

      expect(screen.getByRole("link", { name: "General Settings" })).toBeDefined();
    });
  });

  describe("when the reader may update the project but the page asks to view it", () => {
    it("is still refused, because update does not imply view at this seam", async () => {
      // The hierarchy that makes `project:manage` satisfy `project:view` is
      // applied by the server when it answers the effective permission set, not
      // by the guard: the guard asks for a name and gets a yes or a no.
      await openPage(dataRetentionPageLoaders, RETENTION_KEY, ["project:update"]);

      expect(screen.queryByText(/the retention policies page/)).toBeNull();
    });
  });
});

describe("given the data privacy page", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage(dataPrivacyPageLoaders, PRIVACY_KEY, ["project:view"]);

      expect(screen.getByText(/the data privacy page/)).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    it("is refused, and named the grant it needs", async () => {
      await openPage(dataPrivacyPageLoaders, PRIVACY_KEY, ["auditLog:view"]);

      expect(screen.queryByText(/the data privacy page/)).toBeNull();
      expect(screen.getByText(/project:view/)).toBeDefined();
    });
  });
});
