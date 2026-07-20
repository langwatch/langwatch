/**
 * @vitest-environment jsdom
 *
 * Integration test for ProjectLangyLayout — the layout route that mounts Langy
 * once per project so it survives navigation between project pages.
 *
 * Spec: specs/langy/langy-navigation-persistence.feature
 *
 * Boundary mocks: the gate-input hooks (session / project / flag) and
 * the heavy LangyDrawer chat surface. LangyContext is REAL, so the open/closed
 * state is genuine — its survival across navigation is exactly what we assert.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Controllable gate state (flipped per-test to exercise the visibility gate).
// ---------------------------------------------------------------------------
const gate = {
  flagEnabled: true,
  permissions: ["langy:view"] as string[],
  project: { id: "project-demo", slug: "demo" } as {
    id: string;
    slug: string;
  } | null,
  demoSlug: "not-this-project",
};

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user-1", email: "staff@langwatch.ai" } },
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: gate.project,
    team: {
      isPersonal: false,
      ownerUserId: "someone-else",
      members: [{ userId: "user-1" }],
    },
    organization: { id: "org-1" },
    organizationRole: "MEMBER",
    hasPermission: (permission: string) => gate.permissions.includes(permission),
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  // Defaults to a demo slug that does NOT match the active project, so the
  // demo-project branch of the gate stays out of the way and membership is
  // what counts. The demo-refusal test points it at the active project.
  usePublicEnv: () => ({ data: { DEMO_PROJECT_SLUG: gate.demoSlug } }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: gate.flagEnabled }),
}));

// Stub the heavy chat surface. Open state genuinely lives in the zustand
// store nowadays, so the stub reads the REAL store and exposes a button that
// opens Langy through it. It also counts its own mounts: the layout's whole
// job is "mount once per project", so the tests need to tell a surviving
// panel apart from a remounted one.
const sidecarMounts = { count: 0 };
vi.mock("../components/LangyPanel", () => ({
  LangySidecar: () => <LangySidecarStub />,
  LANGY_DOCKED_OFFSET: 400,
  LANGY_TRANSITION: "200ms",
}));

import { useEffect } from "react";
import ProjectLangyLayout from "../ProjectLangyLayout";
import { useLangyStore } from "../stores/langyStore";

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

const renderAt = (initialPath: string) => {
  const router = createMemoryRouter(
    [
      {
        Component: ProjectLangyLayout,
        children: [
          { path: "/:project/traces", element: <div>traces page</div> },
          { path: "/:project/prompts", element: <div>prompts page</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
  return router;
};

const drawer = () => screen.queryByTestId("langy-drawer");
const openLangy = () =>
  userEvent.click(screen.getByRole("button", { name: "open-langy" }));

beforeEach(() => {
  gate.flagEnabled = true;
  gate.permissions = ["langy:view"];
  gate.project = { id: "project-demo", slug: "demo" };
  gate.demoSlug = "not-this-project";
  // The store is a module singleton — start every test closed and uncounted.
  useLangyStore.setState({ isOpen: false });
  sidecarMounts.count = 0;
});

afterEach(() => cleanup());

describe("ProjectLangyLayout", () => {
  describe("given Langy is open on a project page", () => {
    /** @scenario "The panel stays open when navigating between pages of the same project" */
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
    /** @scenario "Switching projects resets Langy" */
    it("remounts the Langy tree when switching to a different project", async () => {
      const router = renderAt("/demo/traces");
      await openLangy();
      expect(drawer()?.getAttribute("data-open")).toBe("true");
      const mountsBefore = sidecarMounts.count;

      await act(async () => {
        await router.navigate("/acme/traces");
      });

      // key={:project} changed → the whole Langy tree (provider + panel)
      // remounted — the trigger for the panel's per-project reset, which
      // clears the conversation so nothing from "demo" carries into "acme".
      expect(sidecarMounts.count).toBeGreaterThan(mountsBefore);
    });
  });

  // Visibility gate (mirrors the server-side gate in langyAccessGate.ts). The
  // rollout flag is the only lever — there is no staff bypass — and the
  // registry default is off, so the panel is dark until a user is opted in.
  describe("given the rollout-flag visibility gate", () => {
    it("renders Langy for a team member when the rollout flag is on", () => {
      gate.flagEnabled = true;
      renderAt("/demo/traces");
      expect(drawer()).not.toBeNull();
    });

    /** @scenario "The visibility gate is not widened" */
    it("hides Langy for a team member when the rollout flag is off", () => {
      gate.flagEnabled = false;
      renderAt("/demo/traces");
      expect(screen.getByText("traces page")).toBeTruthy();
      expect(drawer()).toBeNull();
    });

    it("hides Langy for a team member without langy:view", () => {
      // A custom role can hold project access without the Langy read grant;
      // rendering the panel would produce a chat whose every call 401s.
      gate.flagEnabled = true;
      gate.permissions = [];
      renderAt("/demo/traces");
      expect(screen.getByText("traces page")).toBeTruthy();
      expect(drawer()).toBeNull();
    });

    /** @scenario "Working at LangWatch is not a way in" */
    it("hides Langy for a @langwatch.ai session when the rollout flag is off", () => {
      // The mocked session is staff@langwatch.ai. Before the flag-only rework
      // that address bypassed the flag outright; pin that it no longer does.
      gate.flagEnabled = false;
      renderAt("/demo/traces");
      expect(drawer()).toBeNull();
    });

    /** @scenario "The demo project refuses Langy on every surface" */
    it("hides Langy on the demo project even with the flag and permission", () => {
      // The server refuses Langy on the demo project outright; the panel
      // mirrors that so it can't render a chat where every send 403s.
      gate.flagEnabled = true;
      gate.demoSlug = "demo";
      renderAt("/demo/traces");
      expect(screen.getByText("traces page")).toBeTruthy();
      expect(drawer()).toBeNull();
    });
  });
});
