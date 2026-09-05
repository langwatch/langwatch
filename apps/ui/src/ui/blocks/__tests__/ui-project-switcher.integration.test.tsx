/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/workspace-switcher.feature
 *       specs/navigation/product-switcher-navigation.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { WithStubNavigationHost } from "@langwatch/navigation-web/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openDrawerMock = vi.fn();

vi.mock("@langwatch/ui-drawer", async () => {
  const actual =
    await vi.importActual<typeof import("@langwatch/ui-drawer")>("@langwatch/ui-drawer");
  return {
    ...actual,
    useDrawer: () => ({ openDrawer: openDrawerMock, closeDrawer: () => {} }),
  };
});

import { UiProjectSwitcher } from "../ui-project-switcher";

// The combobox popup positions itself through Zag's popper, which reaches
// for `ResizeObserver` on every open; jsdom ships none, and its absence
// otherwise surfaces as an unhandled rejection out of an animation frame
// rather than as a clear assertion failure.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

const teamWithNoProjects = {
  id: "team_new",
  name: "New Team",
  isPersonal: false,
  ownerUserId: null,
  members: [],
  projects: [],
};

function renderSwitcher({ permissions }: { permissions: readonly string[] }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          project: { id: "project_1", slug: "demo", name: "Demo" },
          organization: { id: "org_1", name: "Acme", teams: [] },
          organizations: [{ id: "org_1", name: "Acme", teams: [] }],
          openableTeams: [teamWithNoProjects],
          pathname: "/demo",
          permissions,
        }}
      >
        <UiProjectSwitcher />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  openDrawerMock.mockClear();
});

describe("given a reader whose only shared team has no projects yet", () => {
  describe("when they may create a project", () => {
    it("stays visible with a New Project entry in the popup", async () => {
      renderSwitcher({ permissions: ["project:create"] });

      const trigger = screen.getByRole("button", { name: "Switch project" });
      fireEvent.click(trigger);

      await screen.findByText("New Project");
    });
  });

  describe("when they may not create a project", () => {
    /** @scenario An empty team stays hidden from members who cannot create a project on it */
    it("renders nothing at all", () => {
      renderSwitcher({ permissions: [] });

      expect(screen.queryByRole("button", { name: "Switch project" })).toBeNull();
    });
  });
});

describe("given the project list is unfiltered", () => {
  /** @scenario Creating a project stays available while the list is unfiltered */
  it("keeps the New Project entry available before the reader types a search", async () => {
    renderSwitcher({ permissions: ["project:create"] });

    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));

    await waitFor(() => {
      expect(screen.getByText("New Project")).not.toBeNull();
    });
  });
});
