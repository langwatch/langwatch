/**
 * @vitest-environment jsdom
 *
 * `NavigationHostSection` — the root shell every screen in the chrome mounts
 * inside — read the organization graph without checking for a refusal, so a
 * failed `organization.getAll` left the whole application with no scope and
 * no error. Same gap `TraceHost` and `OrganizationHost` had, but here it is
 * the shell wrapping everything else.
 *
 * Spec: specs/auth/session-failure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/navigation-web/screens/landing", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/navigation-web/screens/landing")>(
    "@langwatch/navigation-web/screens/landing",
  );
  return {
    ...actual,
    navigationApi: {
      organization: {
        getAll: {
          useQuery: () => ({ data: void 0, error: graph.error, isLoading: false }),
        },
      },
    },
  };
});

vi.mock("@langwatch/ui-drawer", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/ui-drawer")>("@langwatch/ui-drawer");
  return {
    ...actual,
    useDrawer: () => ({ openDrawer: () => {}, closeDrawer: () => {} }),
  };
});

vi.mock("@langwatch/langy-web", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/langy-web")>("@langwatch/langy-web");
  return {
    ...actual,
    useLangyStore: () => () => {},
  };
});

vi.mock("../../../../behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: false,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
  useUiPlatformAdmin: () => false,
}));

vi.mock("../../../../behavior/ui-scope-storage", () => ({
  useUiScopeMemory: () => ({ selection: { projectSlug: void 0 }, remember: () => {} }),
}));

vi.mock("../../../../behavior/ui-departure", () => ({
  uiLeaveTo: (url: string) => departures.push(url),
  uiOpenExternal: () => {},
}));

import {
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiCapabilities,
} from "../../../../behavior/ui-capabilities";
import { NavigationHostSection } from "../sections/navigation-host";

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
  succeeded(): void {}
  failed(): void {}
}

class SilentTitle extends UiDocumentTitlePort {
  set(): () => void {
    return () => {};
  }
}

class SignedInSession extends UiSessionPort {
  currentUser() {
    return { id: "user-1", name: "Reader", email: "reader@example.com", image: null };
  }
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "project-1" };
  }
  hasPermission(): boolean {
    return true;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return false;
  }
}

function mountNavigation() {
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new SignedInSession(),
  };
  const router = createMemoryRouter(
    [
      {
        path: "/project-1",
        element: (
          <UiCapabilityContextProvider value={capabilities}>
            <NavigationHostSection>
              <div>the chrome</div>
            </NavigationHostSection>
          </UiCapabilityContextProvider>
        ),
      },
    ],
    { initialEntries: ["/project-1"] },
  );
  render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  graph.error = null;
  departures.length = 0;
});
afterEach(cleanup);

describe("given the organization graph refuses for a reason the reader can read", () => {
  describe("when the navigation shell renders", () => {
    /** @scenario "A refused organization graph renders its handled failure, never a blank page" */
    it("renders the registered copy instead of hanging on an empty document", () => {
      graph.error = {
        data: {
          error: {
            code: "clickhouse_unavailable",
            httpStatus: 503,
            traceId: "trace_01J9Z",
          },
        },
      };

      mountNavigation();

      expect(departures).toEqual([]);
      expect(screen.getByText("Search is temporarily unavailable")).toBeTruthy();
      expect(screen.queryByText("the chrome")).toBeNull();
    });
  });
});

describe("given the organization graph answered", () => {
  describe("when the navigation shell renders", () => {
    it("renders what it is mounted around", () => {
      mountNavigation();

      expect(departures).toEqual([]);
      expect(screen.getByText("the chrome")).toBeTruthy();
    });
  });
});
