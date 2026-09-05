/**
 * What each automations address is actually behind, proved by mounting it.
 * @vitest-environment jsdom
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
} from "@langwatch/ui-host/capabilities";
import { automationsFeature } from "../src/features/automations";
import { MemoryRouter } from "react-router";

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
  const loader = automationsFeature.loaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
  // The refusal fallbacks are Chakra, so a refused page needs a system even
  // though the page it refuses never renders.
  render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
          <Mounted />
        </UiCapabilityContextProvider>
      </ChakraProvider>
    </MemoryRouter>,
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
