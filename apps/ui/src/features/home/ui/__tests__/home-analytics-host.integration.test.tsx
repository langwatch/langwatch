/**
 * The project home draws analytics surfaces — the traces overview and the
 * briefing's vanity strip — and those read the analytics host. The home page
 * mounted only its own host, so `/` and `/<project>` threw
 * "The analytics screens must be mounted inside an AnalyticsHostProvider."
 * before anything rendered.
 * @vitest-environment jsdom
 * Spec: specs/home/home-views.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/analytics-web/analytics", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/analytics-web/analytics")>(
    "@langwatch/analytics-web/analytics",
  );
  return {
    ...actual,
    analyticsApi: {
      organization: {
        getAll: { useQuery: () => ({ data: [], error: null, isLoading: false }) },
      },
    },
  };
});

vi.mock("@langwatch/project-web/home", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/project-web/home")>(
    "@langwatch/project-web/home",
  );
  const { useAnalyticsHost } = await vi.importActual<
    typeof import("@langwatch/analytics-web/analytics")
  >("@langwatch/analytics-web/analytics");
  // The screen stands in for the real one at the ONE thing this pins: it reads
  // the analytics host, exactly as the traces overview and the vanity strip do.
  const HomeScreen = () => {
    const host = useAnalyticsHost();
    return <h1>Home for {host.organizationId() ?? "no organization"}</h1>;
  };
  return {
    ...actual,
    homeApi: {
      organization: {
        getAll: { useQuery: () => ({ data: [], error: null, isLoading: false }) },
      },
    },
    projectHomeScreens: {
      ...actual.projectHomeScreens,
      home: async () => ({ default: HomeScreen }),
    },
  };
});

import {
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/ui-host/capabilities";

import { homePageLoaders } from "../sections/home-routes";

class SilentNavigation extends UiNavigationPort {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoutePort {
  reading() {
    return { params: { project: "project-1" }, query: {} };
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

afterEach(cleanup);

describe("given the project home page as its route installs it", () => {
  describe("when the home screen reads the analytics host", () => {
    /** @scenario "The project home renders the analytics surfaces it draws" */
    it("renders the page rather than throwing for a missing analytics host", async () => {
      const loader = homePageLoaders["pages/[project]/index"];
      expect(loader).toBeDefined();
      const { default: Page } = await loader!();

      const capabilities: UiCapabilities = {
        documentTitle: new SilentTitle(),
        feedback: new SilentFeedback(),
        navigation: new SilentNavigation(),
        route: new SilentRoute(),
        session: new SignedInSession(),
      };

      render(
        <ChakraProvider value={defaultSystem}>
          <MemoryRouter initialEntries={["/project-1"]}>
            <UiCapabilityContextProvider value={capabilities}>
              <Page />
            </UiCapabilityContextProvider>
          </MemoryRouter>
        </ChakraProvider>,
      );

      expect(screen.getByRole("heading", { name: "Home for org-1" })).toBeTruthy();
    });
  });
});
