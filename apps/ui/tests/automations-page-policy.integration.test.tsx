/**
 * @vitest-environment jsdom
 *
 * What each automations address is actually behind, proved by mounting it.
 *
 * `automations-routes.unit.test.ts` pins which tab each key shows;
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering. Neither would notice
 * a loader that names the wrong grant — which is the failure that refuses a
 * reader the platform page admitted, or admits one it refused. So this file
 * loads the real loaders, mounts what they hand back under a session that
 * answers precisely, and reads the result.
 *
 * The screen itself is faked, and so is the transport the host provider reads
 * the organization graph over. What is under test is the policy the frontend
 * feature wraps the screen in, and loading a thousand lines of Chakra over a
 * live tRPC client to assert a refusal would test the screen instead.
 *
 * `triggers:view` is the platform page's own grant, carried over one for one
 * from `withPermissionGuard("triggers:view")`. It is not a flag: this family
 * released long ago and the platform page was behind none.
 *
 * Spec: specs/automations/authoring-drawer.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/automation-web/screens/automations", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/automation-web/screens/automations")
  >("@langwatch/automation-web/screens/automations");
  const Screen = ({ section }: { section?: string }) => <div>the automations page: {section}</div>;
  const emptyQuery = { data: undefined, isLoading: false };
  const apiNode = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          return apiNode();
        },
      },
    );
  return {
    ...actual,
    automationApi: apiNode(),
    automationScreens: { automations: async () => ({ default: Screen }) },
  };
});

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
import { automationsPageLoaders } from "../src/features/automations";

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
    return null;
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
  const loader = automationsPageLoaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
  // The refusal fallbacks are Chakra, so a refused page needs a system even
  // though the page it refuses never renders.
  render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
        <Mounted />
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given the automations overview", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage("pages/[project]/automations", ["triggers:view"]);

      expect(screen.getByText(/the automations page/)).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    it("is refused, and named the grant it needs", async () => {
      await openPage("pages/[project]/automations", ["analytics:view"]);

      expect(screen.queryByText(/the automations page/)).toBeNull();
      expect(screen.getByText(/triggers:view/)).toBeDefined();
    });
  });
});

describe("given the three deeper tabs and the activity address", () => {
  describe("when a reader with the grant opens each", () => {
    it.each([
      ["pages/[project]/automations/automations", "automations"],
      ["pages/[project]/automations/alerts", "alerts"],
      ["pages/[project]/automations/schedules", "schedules"],
      // The fifth address has shown the overview since the History tab was
      // folded into it; the key is kept because links to it exist.
      ["pages/[project]/automations/activity", "overview"],
    ])("%s shows the %s tab", async (key, section) => {
      await openPage(key, ["triggers:view"]);

      expect(screen.getByText(`the automations page: ${section}`)).toBeDefined();
    });
  });

  describe("when the reader lacks the grant", () => {
    it("refuses every tab, not only the one the guard was written for", async () => {
      await openPage("pages/[project]/automations/alerts", []);

      expect(screen.queryByText(/the automations page/)).toBeNull();
      expect(screen.getByText(/triggers:view/)).toBeDefined();
    });
  });
});
