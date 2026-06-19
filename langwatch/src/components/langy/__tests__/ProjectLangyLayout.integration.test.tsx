/**
 * @vitest-environment jsdom
 *
 * Integration test for ProjectLangyLayout — the layout route that mounts Langy
 * once per project so it survives navigation between project pages.
 *
 * Spec: specs/assistant/langy-navigation-persistence.feature
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

// Stub the heavy chat surface. It reflects the isOpen prop it receives and
// exposes a button to open Langy, so the test can drive + observe open state.
vi.mock("../LangySidebar", () => ({
  LangyDrawer: ({
    isOpen,
    onOpenChange,
  }: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="langy-drawer" data-open={String(isOpen)}>
      <button type="button" onClick={() => onOpenChange(true)}>
        open-langy
      </button>
    </div>
  ),
  LANGY_DOCKED_OFFSET: 400,
  LANGY_TRANSITION: "200ms",
}));

import ProjectLangyLayout from "../ProjectLangyLayout";

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
});

afterEach(() => cleanup());

describe("ProjectLangyLayout", () => {
  describe("given Langy is open on a project page", () => {
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
      // ...but the provider was not remounted, so open state survived.
      expect(drawer()?.getAttribute("data-open")).toBe("true");
    });
  });

  describe("given Langy is open in one project", () => {
    it("resets when switching to a different project", async () => {
      const router = renderAt("/demo/traces");
      await openLangy();
      expect(drawer()?.getAttribute("data-open")).toBe("true");

      await act(async () => {
        await router.navigate("/acme/traces");
      });

      // key={:project} changed → provider remounted → open state reset.
      expect(drawer()?.getAttribute("data-open")).toBe("false");
    });
  });

  // Visibility gate (re-instated for PR #4913, mirrors the server-side gate in
  // routes/langy.ts). Staff bypass the rollout flag; for everyone else the
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

    it("hides Langy for a non-staff team member when the rollout flag is off", () => {
      gate.staff = false;
      gate.flagEnabled = false;
      renderAt("/demo/traces");
      expect(screen.getByText("traces page")).toBeTruthy();
      expect(drawer()).toBeNull();
    });
  });
});
