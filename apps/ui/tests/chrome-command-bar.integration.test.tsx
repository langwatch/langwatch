/**
 * @vitest-environment jsdom
 *
 * THE SEARCH PALETTE, FROM THE SHELL, ON THIS APPLICATION'S OWN HOST.
 *
 * Eighteen family manifests recorded the same absence in a different shape:
 * `commandBar()` answered `null`, so the sidebar drew no Quick Search row, the
 * top bar drew no trigger, and Cmd+K opened nothing. This is the suite that
 * says it answers.
 *
 * It mounts the REAL host — `NavigationHostSection`, the same one the chrome
 * layout route mounts, with the same `commandBar` flag — around the REAL shell,
 * and drives the palette the way a reader does: press the trigger the top bar
 * draws, type, press Enter. What is asserted is where the reader ENDS UP, since
 * that is the whole of what a command is: an address, or a drawer.
 *
 * The one thing stubbed is the workspace graph. `NavigationHostSection` reads it
 * off `organization.getAll`, and a suite about the palette should not also be a
 * suite about a network. Everything else — the adapter, the palette's own five
 * searches, the shell's four reads — runs for real against a client with no
 * server behind it, which is exactly the frame `chrome-layout.integration` uses
 * and for the same reason: each of those renders nothing until it has data.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
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
 *
 * `NavigationHostSection` imports `navigationApi` from THIS entry, so replacing
 * one procedure here decides what the host reads — while the shell's own reads,
 * which import the same map through the package's internal path, keep the real
 * client. `Provider` is the actual one for that reason.
 */
vi.mock("@langwatch/navigation-web/screens/landing", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/navigation-web/screens/landing")
  >("@langwatch/navigation-web/screens/landing");
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

import { navigationApi } from "@langwatch/navigation-web/screens/landing";
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
} from "../src/behavior/ui-capabilities";
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
 *
 * A drawer open is an ADDRESS — `?drawer.open=<name>` — and under a memory
 * router that address lives in router state rather than in `window.location`,
 * so the only honest way to read it is to render it.
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

      expect(
        await screen.findByPlaceholderText("Where would you like to go?"),
      ).toBeTruthy();
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
        expect(screen.getByTestId("address").textContent).toContain(
          "drawer.open=promptEditor",
        );
      });
    });
  });
});
