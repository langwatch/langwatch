/**
 * @vitest-environment jsdom
 *
 * Integration test for `ProjectLangyLayout` — the layout route that mounts
 * Langy once per project so it survives navigation between project pages.
 *
 * Spec: specs/langy/langy-navigation-persistence.feature
 *       specs/langy/langy-worker-prewarm.feature
 *
 * Boundary mocks: the host port (project / team / permissions / feature flag,
 * subscribable so a project switch mid-test genuinely re-renders the layout
 * the way the real resolver's own query subscription would), `useDrawer`, and
 * the heavy `LangySidecar` chat surface. `LangyContext` and the Langy store are
 * REAL, so the open/closed state is genuine — its survival across navigation
 * is exactly what is under test.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Controllable host state (flipped per-test to exercise the visibility gate).
// The layout keys Langy by the AMBIENT project the host resolves, so the fake
// host is SUBSCRIBABLE: in production a project change re-renders the layout
// through the host's own query subscription, and a static value would
// silently skip exactly the re-render under test. `setGateProject` notifies
// like the real resolver does.
// ---------------------------------------------------------------------------
type GateProject = { id: string; slug: string; name: string } | undefined;

const gate = {
  flagEnabled: true,
  permissions: ["langy:view"] as string[],
  project: { id: "project-demo", slug: "demo", name: "demo" } as GateProject,
};
const gateListeners = new Set<() => void>();
const setGateProject = (project: GateProject) => {
  gate.project = project;
  for (const notify of gateListeners) notify();
};

const drawerState = { current: null as string | null };
vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ currentDrawer: drawerState.current }),
}));

// Stub the heavy chat surface. Open state genuinely lives in the zustand
// store, so the stub reads the REAL store and exposes a button that opens
// Langy through it. It also counts its own mounts: the layout's whole job is
// "mount once per project", so the tests need to tell a surviving panel apart
// from a remounted one.
const sidecarMounts = { count: 0 };
vi.mock("../langy-panel", () => ({
  LangySidecar: () => <LangySidecarStub />,
}));

import ProjectLangyLayout from "../project-langy-layout";
import { useLangyStore } from "../../../../../index";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../model/langy-host";

function LangySidecarStub() {
  const isOpen = useLangyStore((s) => s.isOpen);
  const openPanel = useLangyStore((s) => s.openPanel);
  useEffect(() => {
    sidecarMounts.count++;
  }, []);
  return (
    <div data-testid="langy-drawer" data-open={String(isOpen)}>
      <button type="button" onClick={openPanel}>
        open-langy
      </button>
    </div>
  );
}

class FakeLangyHost extends LangyHostPort {
  constructor(
    private readonly state: {
      project: LangyHostProject | undefined;
      organization: LangyHostOrganization;
      team: LangyHostTeam;
      permissions: string[];
      flagEnabled: boolean;
    },
  ) {
    super();
  }
  project() {
    return this.state.project;
  }
  organization() {
    return this.state.organization;
  }
  team() {
    return this.state.team;
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasPermission(permission: string) {
    return this.state.permissions.includes(permission);
  }
  isLoading() {
    return false;
  }
  featureFlag() {
    return this.state.flagEnabled;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}

/** Re-renders with a fresh host whenever `setGateProject` notifies. */
function TestHost({ children }: { children: React.ReactNode }) {
  const project = useSyncExternalStore(
    (onChange) => {
      gateListeners.add(onChange);
      return () => gateListeners.delete(onChange);
    },
    () => gate.project,
  );
  const host = useMemo(
    () =>
      new FakeLangyHost({
        project,
        organization: { id: "org-1" },
        team: { id: "team-1", isPersonal: false, ownerUserId: "someone-else", members: [{ userId: "user-1" }] },
        permissions: gate.permissions,
        flagEnabled: gate.flagEnabled,
      }),
    [project],
  );
  return <LangyHostProvider value={host}>{children}</LangyHostProvider>;
}

const renderAt = (initialPath: string) => {
  const router = createMemoryRouter(
    [
      {
        Component: () => (
          <ProjectLangyLayout>
            <Outlet />
          </ProjectLangyLayout>
        ),
        children: [
          { path: "/:project/traces", element: <div>traces page</div> },
          { path: "/:project/prompts", element: <div>prompts page</div> },
          { path: "/settings", element: <div>settings page</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(
    <ChakraProvider value={defaultSystem}>
      <TestHost>
        <RouterProvider router={router} />
      </TestHost>
    </ChakraProvider>,
  );
  return router;
};

const drawer = () => screen.queryByTestId("langy-drawer");
const openLangy = () => userEvent.click(screen.getByRole("button", { name: "open-langy" }));

beforeEach(() => {
  gate.flagEnabled = true;
  gate.permissions = ["langy:view"];
  gate.project = { id: "project-demo", slug: "demo", name: "demo" };
  drawerState.current = null;
  // The store is a module singleton — start every test closed and uncounted.
  useLangyStore.setState({
    isOpen: false,
    panelMode: "floating",
    dockShellClaims: 0,
    dockShifted: false,
  });
  sidecarMounts.count = 0;
});

afterEach(() => cleanup());

describe("ProjectLangyLayout", () => {
  describe("given Langy is open on a project page", () => {
    /** @scenario The panel stays open when navigating between pages of the same project */
    it("stays open when navigating to another page of the same project", async () => {
      const router = renderAt("/demo/traces");
      expect(screen.getByText("traces page")).toBeTruthy();
      expect(drawer()?.getAttribute("data-open")).toBe("false");

      await openLangy();
      expect(drawer()?.getAttribute("data-open")).toBe("true");

      await act(async () => {
        await router.navigate("/demo/prompts");
      });

      // The page under the Outlet swapped...
      expect(screen.getByText("prompts page")).toBeTruthy();
      // ...but the Langy tree was not remounted, so open state survived.
      expect(drawer()?.getAttribute("data-open")).toBe("true");
      expect(sidecarMounts.count).toBe(1);
    });
  });

  describe("given Langy is open in one project", () => {
    /** @scenario Switching projects resets Langy */
    it("remounts the Langy tree when the ambient project changes", async () => {
      const router = renderAt("/demo/traces");
      await openLangy();
      expect(drawer()?.getAttribute("data-open")).toBe("true");
      const mountsBefore = sidecarMounts.count;

      // The reset boundary is the AMBIENT project (what the host resolves),
      // not the URL segment.
      await act(async () => {
        setGateProject({ id: "project-acme", slug: "acme", name: "acme" });
        await router.navigate("/acme/traces");
      });

      // key={project.id} changed → the whole Langy tree (provider + panel)
      // remounted — the trigger for the panel's per-project reset, which
      // clears the conversation so nothing from "demo" carries into "acme".
      expect(sidecarMounts.count).toBeGreaterThan(mountsBefore);
    });

    /** @scenario Langy travels into settings and back */
    it("stays mounted on settings while the ambient project holds", async () => {
      const router = renderAt("/demo/traces");
      await openLangy();
      const mountsBefore = sidecarMounts.count;

      await act(async () => {
        await router.navigate("/settings");
      });

      // Settings has no :project segment, but the ambient project is
      // unchanged, so the panel neither unmounts nor resets.
      expect(screen.getByText("settings page")).toBeTruthy();
      expect(drawer()?.getAttribute("data-open")).toBe("true");
      expect(sidecarMounts.count).toBe(mountsBefore);
    });
  });

  // Visibility gate (mirrors the server-side gate). The rollout flag is the
  // only lever — the registry default is off, so the panel is dark until a
  // user is opted in.
  describe("given the rollout-flag visibility gate", () => {
    describe("when the rollout flag is off", () => {
      /** @scenario The visibility gate is not widened */
      // The pre-warm hook lives inside the sidecar, so a user without Langy
      // never mounts it and no warm request can fire.
      /** @scenario A user without Langy never triggers a warm */
      it("hides Langy for a team member", () => {
        gate.flagEnabled = false;
        renderAt("/demo/traces");
        expect(screen.getByText("traces page")).toBeTruthy();
        expect(drawer()).toBeNull();
        expect(sidecarMounts.count).toBe(0);
      });
    });
  });
});
