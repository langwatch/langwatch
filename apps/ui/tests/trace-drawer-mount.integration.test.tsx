/**
 * @vitest-environment jsdom
 *
 * The trace drawer, opened from a page that is not the Trace Explorer.
 *
 * THE GAP THIS PINS SHUT. `routeTraceDrawerForV2` rewrites every `traceDetails`
 * open into `traceV2Details`, and `traceV2Details` is not — cannot be — a
 * registry entry: the drawer keeps its open trace in a store and syncs the URL
 * onto it, and that sync has to outlive the `?drawer.open=` parameter. So the
 * chrome mounts the drawer itself, beside `CurrentDrawer`. When the shell moved
 * into `@langwatch/navigation-web` the mount did not travel with it, and every
 * "View trace" affordance outside `/:project/traces` wrote an address that
 * opened nothing — silently, because `CurrentDrawer` renders null on a name it
 * does not know.
 *
 * The address, the chrome layout route, the capability ports, the trace host,
 * the URL → store sync and the mount decision are all real. Only the drawer's
 * own shell is stubbed: what is under test is whether anything mounts it at
 * all, and the real one drags the waterfall, the transcript renderer and their
 * syntax highlighters behind it.
 *
 * See specs/traces-v2/default-drawer-routing.feature.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { WithStubNavigationHost } from "@langwatch/navigation-web/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Enough workspace for the trace host to resolve the project in scope: it
 * reads the graph the shell reads, and answers its empty shell without one.
 */
const TEAM = {
  id: "team-1",
  name: "Core",
  members: [{ userId: "user-1" }],
  projects: [{ id: "project-1", name: "Acme App", slug: "acme" }],
};
const ORGANIZATION = { id: "org-1", name: "Acme", teams: [TEAM] };
const SHELL_READINGS = {
  organizations: [ORGANIZATION],
  organization: ORGANIZATION,
  team: TEAM,
  project: TEAM.projects[0],
  currentUser: { id: "user-1", name: "Ada", email: "ada@example.com", image: null },
  permissions: ["traces:view"],
  pathname: "/acme/simulations",
};

vi.mock("../../../packages/features/trace/web/src/ui/sections/explorer/trace-drawer", () => ({
  TraceV2DrawerShell: () => <div data-testid="trace-drawer">trace drawer</div>,
}));

/**
 * The one read the trace host makes for itself, answered without a transport.
 *
 * `organization.getAll` is how the host resolves the project the address is
 * about; everything else this module exports — the host provider, the drawer
 * mount's own loader, the failure singleton — stays real, because those are
 * what the wiring under test is made of.
 */
vi.mock("@langwatch/trace-web/screens/traces", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/trace-web/screens/traces")>(
    "@langwatch/trace-web/screens/traces",
  );
  return {
    ...actual,
    traceApi: {
      organization: {
        getAll: {
          useQuery: () => ({ data: [ORGANIZATION], isLoading: false }),
        },
      },
    },
  };
});

vi.mock("../src/features/navigation", () => ({
  NavigationHostSection: ({ children }: { children: ReactNode }) => (
    <WithStubNavigationHost readings={SHELL_READINGS}>
      <Capabilities>{children}</Capabilities>
    </WithStubNavigationHost>
  ),
}));

vi.mock("../src/features/installed-ui-page-keys", () => ({
  isUiInstalledPage: () => false,
}));

vi.mock("../src/features/installed-ui-drawers", () => ({
  installedUiDrawers: {},
}));

import {
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiSessionPort,
  type UiActiveScope,
  type UiActor,
} from "../src/behavior/ui-capabilities";
import { useRouterUiNavigation, useRouterUiRoute } from "../src/behavior/ui-router-navigation";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";
import { useDrawerStore } from "@langwatch/trace-web/drawer.store";

class SilentTitle extends UiDocumentTitlePort {
  set(): () => void {
    return () => {};
  }
}

class SilentFeedback extends UiFeedbackPort {
  succeeded(): void {}
  failed(): void {}
}

/** A signed-in reader on one project, which is all the trace host reads. */
class ProjectSession extends UiSessionPort {
  currentUser(): UiActor {
    return { id: "user-1", name: "Ada", email: "ada@example.com", image: null };
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
    return void 0;
  }
}

/**
 * The capability ports, resolved where `ui-feature-shell` resolves them:
 * inside the router, because two of the five are router readings and the trace
 * host answers the drawer's address out of one of them.
 */
function Capabilities({ children }: { children: ReactNode }) {
  const navigation = useRouterUiNavigation();
  const route = useRouterUiRoute();
  const [documentTitle] = useState(() => new SilentTitle());
  const [session] = useState(() => new ProjectSession());
  const [feedback] = useState(() => new SilentFeedback());
  const capabilities = useMemo(
    () =>
      resolveUiCapabilities({
        install: { feedback, session },
        documentTitle,
        navigation,
        route,
      }),
    [documentTitle, feedback, navigation, route, session],
  );
  return <UiCapabilityContextProvider value={capabilities}>{children}</UiCapabilityContextProvider>;
}

const loaders = {
  "features/chrome/UiAppChrome": () => import("../src/features/chrome/ui/sections/ui-app-chrome"),
  "pages/simulations": async () => ({ default: () => <div>simulation run</div> }),
  "pages/traces": async () => ({ default: () => <div>trace explorer</div> }),
};

function renderAt(path: string) {
  const routes = createUiRouteObjects({
    table: [
      {
        page: "features/chrome/UiAppChrome",
        children: [
          { path: "/:project/simulations", page: "pages/simulations" },
          { path: "/:project/traces", page: "pages/traces" },
        ],
      },
    ],
    loaders,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ChakraProvider value={defaultSystem}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
      </QueryClientProvider>
    </ChakraProvider>,
  );
}

/**
 * The mount's chunk, fetched before any test renders.
 *
 * `lazy()` resolves on a microtask once the module is in the registry, so
 * warming it here is what makes "no drawer on screen" mean the mount decided
 * against one rather than that its chunk had not landed yet. Without it the
 * two negative assertions below would pass against a mount nobody wired.
 */
beforeAll(async () => {
  const { traceDrawerMount } = await import("@langwatch/trace-web/screens/traces");
  await traceDrawerMount();
  // The chunk is the trace drawer's whole closure. Loading it takes longer
  // than a test does, and longer still when the rest of the suite is loading
  // modules beside it, so the hook is given a budget of its own.
}, 60_000);

/** One turn of the event loop inside `act`, for the warmed chunk to render. */
async function settleLazyMount(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  useDrawerStore.setState({ traceId: null });
});

describe("given an address on a page that is not the Trace Explorer", () => {
  describe("when it names the trace drawer", () => {
    /** @scenario "The trace drawer opens over a page that is not the Trace Explorer" */
    it("opens the trace drawer over the page the reader is on", async () => {
      renderAt("/acme/simulations?drawer.open=traceV2Details&drawer.traceId=trace-1");

      expect(await screen.findByText("simulation run")).toBeTruthy();
      // The mount is loaded on demand, so the drawer arrives a chunk later
      // than the page under it; the default one-second wait is not enough for
      // that import when the whole suite is loading modules at once.
      expect(await screen.findByTestId("trace-drawer", {}, { timeout: 8000 })).toBeTruthy();
      await waitFor(() => {
        expect(useDrawerStore.getState().traceId).toBe("trace-1");
      });
    });
  });

  describe("when it names no drawer at all", () => {
    it("mounts no drawer", async () => {
      renderAt("/acme/simulations");

      expect(await screen.findByText("simulation run")).toBeTruthy();
      await settleLazyMount();
      expect(screen.queryByTestId("trace-drawer")).toBeNull();
    });
  });
});

describe("given the reader is on the Trace Explorer, which mounts its own shell", () => {
  describe("when the address names the trace drawer", () => {
    /**
     * Two shells over one trace is what the skip exists to prevent, and the
     * check has to answer to the RESOLVED path `apps/ui` reports rather than
     * the Next route template `platform/app` did.
     */
    /** @scenario "The Trace Explorer is left to draw its own drawer" */
    it("leaves the drawer to the page", async () => {
      renderAt("/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1");

      expect(await screen.findByText("trace explorer")).toBeTruthy();
      await settleLazyMount();
      expect(screen.queryByTestId("trace-drawer")).toBeNull();
    });
  });
});
