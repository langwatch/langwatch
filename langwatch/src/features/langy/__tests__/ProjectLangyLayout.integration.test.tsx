/**
 * @vitest-environment jsdom
 *
 * Integration test for ProjectLangyLayout — the layout route that mounts Langy
 * once per project so it survives navigation between project pages.
 *
 * Spec: specs/langy/langy-navigation-persistence.feature
 *
 * Boundary mocks: the gate-input hooks (session / project / flag / staff) and
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
  staff: true,
  flagEnabled: true,
  project: { id: "project-demo", slug: "demo" } as {
    id: string;
    slug: string;
  } | null,
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
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  // A demo slug that does NOT match the active project, so the demo-project
  // branch of the gate stays out of the way and membership is what counts.
  usePublicEnv: () => ({ data: { DEMO_PROJECT_SLUG: "not-this-project" } }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: gate.flagEnabled }),
}));

vi.mock("~/utils/isLangwatchStaff", () => ({
  isLangwatchStaff: () => gate.staff,
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
  gate.staff = true;
  gate.flagEnabled = true;
  gate.project = { id: "project-demo", slug: "demo" };
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

  // Visibility gate (re-instated for PR #4913, mirrors the server-side tRPC
  // gate). Staff bypass the rollout flag; for everyone else the
  // flag must resolve true. The registry default is off, so non-staff are
  // dark by default and the panel must not render.
  describe("given the staff + rollout-flag visibility gate", () => {
    it("renders Langy for staff even when the rollout flag is off", () => {
      gate.staff = true;
      gate.flagEnabled = false;
      renderAt("/demo/traces");
      expect(screen.getByText("traces page")).toBeTruthy();
      expect(drawer()).not.toBeNull();
    });

    it("renders Langy for a non-staff team member when the rollout flag is on", () => {
      gate.staff = false;
      gate.flagEnabled = true;
      renderAt("/demo/traces");
      expect(drawer()).not.toBeNull();
    });

    /** @scenario "The visibility gate is not widened" */
    it("hides Langy for a non-staff team member when the rollout flag is off", () => {
      gate.staff = false;
      gate.flagEnabled = false;
      renderAt("/demo/traces");
      expect(screen.getByText("traces page")).toBeTruthy();
      expect(drawer()).toBeNull();
    });
  });
});
