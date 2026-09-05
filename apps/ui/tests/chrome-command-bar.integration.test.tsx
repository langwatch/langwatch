/**
 * THE SEARCH PALETTE, FROM THE SHELL, ON THIS APPLICATION'S OWN HOST.
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEAM = {
  id: "team-1",
  name: "Core",
  members: [{ userId: "user-1" }],
  projects: [{ id: "project-1", name: "Acme App", slug: "acme-app" }],
};
const ORGANIZATION = { id: "org-1", name: "Acme", slug: "acme", teams: [TEAM] };

const graph = vi.hoisted(() => ({ organizations: [] as unknown[] }));

/**
 * The graph, answered without a server.
 */
vi.mock("@langwatch/navigation-web/screens/navigation", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/navigation-web/screens/navigation")
  >("@langwatch/navigation-web/screens/navigation");
  return {
    ...actual,
    // A Proxy rather than a spread: the procedure map is built lazily, so
    // copying its keys copies nothing — including the `Provider` the shell's
    // own reads are mounted under.
    navigationApi: new Proxy(actual.navigationApi, {
      get(target, property, receiver) {
        if (property === "organization") {
          return {
            getAll: { useQuery: () => ({ data: graph.organizations, isLoading: false }) },
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }),
  };
});

vi.mock("../src/behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: false,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
}));

import { navigationApi } from "@langwatch/navigation-web/screens/navigation";
import { NavigationShell } from "@langwatch/navigation-web/chrome";
import {
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
} from "@langwatch/ui-host/capabilities";
import { createUiFeatureApiClient } from "../src/behavior/ui-feature-transport";
import { NavigationHostSection } from "../src/features/navigation";

class RecordingNavigation extends UiNavigationPort {
  readonly visited: string[] = [];
  navigate(to: string): void {
    this.visited.push(to);
  }
  replace(to: string): void {
    this.visited.push(to);
  }
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

/** A member of the team that holds the project on screen, with no Langy. */
class ShellSession extends UiSessionPort {
  currentUser(): UiActor {
    return { id: "user-1", name: "Ada", email: "ada@example.com", image: null };
  }
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "project-1" };
  }
  hasPermission(permission: string): boolean {
    return permission === "organization:view";
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return false;
  }
}

/**
 * A desktop viewport, because jsdom implements no `matchMedia` at all and the
 * shell would otherwise draw its phone chrome, where there is no sidebar column
 * and no header trigger to press.
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

/**
 * The address the router is on, as text.
 */
function AddressProbe() {
  const location = useLocation();
  return <div data-testid="address">{`${location.pathname}${location.search}`}</div>;
}

function Mounted({ navigation }: { navigation: RecordingNavigation }) {
  useDesktopViewport();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [client] = useState(() => createUiFeatureApiClient());
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation,
    route: new SilentRoute(),
    session: new ShellSession(),
  };
  return (
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/acme-app"]}>
        <QueryClientProvider client={queryClient}>
          <navigationApi.Provider client={client} queryClient={queryClient}>
            <UiCapabilityContextProvider value={capabilities}>
              <NavigationHostSection commandBar>
                <NavigationShell>
                  <AddressProbe />
                </NavigationShell>
              </NavigationHostSection>
            </UiCapabilityContextProvider>
          </navigationApi.Provider>
        </QueryClientProvider>
      </MemoryRouter>
    </ChakraProvider>
  );
}

function renderShell(): RecordingNavigation {
  const navigation = new RecordingNavigation();
  render(<Mounted navigation={navigation} />);
  return navigation;
}

/** Presses the header trigger and waits for the palette's own field. */
async function openPalette(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByLabelText("Open command bar"));
  return await screen.findByPlaceholderText("Where would you like to go?");
}

beforeEach(() => {
  graph.organizations = [ORGANIZATION];
  window.localStorage.clear();
  // jsdom implements no `scrollIntoView`, and the palette keeps the selected
  // row in view on every keystroke.
  Element.prototype.scrollIntoView = () => void 0;
});

// This package runs without vitest globals, so testing-library registers no
// auto-cleanup of its own.
afterEach(() => cleanup());

describe("given the chrome mounts the search palette", () => {
  describe("when the shell is drawn", () => {
    it("offers both of the entries that read the host's answer", async () => {
      renderShell();

      // The sidebar's first row and the top bar's trigger are the two leaves
      // that were dark while `commandBar()` answered null.
      expect(await screen.findByLabelText("Quick Search")).toBeTruthy();
      expect(screen.getByLabelText("Open command bar")).toBeTruthy();
    });
  });

  describe("when the reader opens it from the sidebar row", () => {
    it("raises the palette", async () => {
      renderShell();

      fireEvent.click(await screen.findByLabelText("Quick Search"));

      expect(await screen.findByPlaceholderText("Where would you like to go?")).toBeTruthy();
    });
  });

  describe("when the reader runs a navigation command", () => {
    it("lands on that page in the project they are in", async () => {
      const navigation = renderShell();
      const field = await openPalette();

      fireEvent.change(field, { target: { value: "Analytics" } });
      await waitFor(() => {
        expect(screen.getByText("Analytics dashboard")).toBeTruthy();
      });
      fireEvent.keyDown(field, { key: "Enter" });

      await waitFor(() => {
        expect(navigation.visited).toContain("/acme-app/analytics");
      });
    });
  });

  describe("when the reader runs a command that opens another family's drawer", () => {
    it("puts the drawer's name in the address, which is all the palette knows", async () => {
      renderShell();
      const field = await openPalette();

      fireEvent.change(field, { target: { value: "New Prompt" } });
      await waitFor(() => {
        expect(screen.getByText("Create a new prompt")).toBeTruthy();
      });
      fireEvent.keyDown(field, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByTestId("address").textContent).toContain("drawer.open=promptEditor");
      });
    });
  });
});
