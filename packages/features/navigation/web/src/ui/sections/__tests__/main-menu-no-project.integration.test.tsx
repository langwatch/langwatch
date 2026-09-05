/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/project-scoped-destinations.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({ data: 0 }) } },
  },
}));

import { WithStubNavigationHost, type StubNavigationReadings } from "../../../testing";
import { MainMenuSections } from "../main-menu";

const PROJECT = { id: "project-1", slug: "demo", name: "Demo" };

function renderMenu(readings: Partial<StubNavigationReadings> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost readings={{ pathname: "/[project]", ...readings }}>
        <MainMenuSections showExpanded />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

/** Every real anchor the rail renders, with the destination it points at. */
const anchorHrefs = () =>
  Array.from(document.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href"));

async function expandSimulations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Expand Simulations" }));
  await screen.findByRole("link", { name: "Scenarios" });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("<MainMenuSections showExpanded />", () => {
  describe("given the account has no project yet", () => {
    /** @scenario "No destination sends a signed-in person to sign in again" */
    it("sends nobody to the sign-in page", () => {
      renderMenu({ project: undefined });

      expect(anchorHrefs()).not.toContain("/auth/signin");
    });

    it("marks a project destination unavailable instead of linking it", () => {
      renderMenu({ project: undefined });

      const home = screen.getByRole("link", { name: "Home" });

      expect(home).toHaveAttribute("aria-disabled", "true");
      expect(home).not.toHaveAttribute("href");
    });

    /** @scenario "A destination inside a project says why it cannot be opened" */
    it("states why the destination cannot be opened", async () => {
      const user = userEvent.setup();
      renderMenu({ project: undefined });

      await user.hover(screen.getByRole("link", { name: "Analytics" }));

      expect(await screen.findByText("Create a project first to open Analytics.")).toBeTruthy();
    });

    /** @scenario "Grouped destinations follow the same rule" */
    it("marks every grouped destination unavailable too", async () => {
      const user = userEvent.setup();
      renderMenu({ project: undefined });
      await expandSimulations(user);

      for (const label of ["Scenarios", "Runs"]) {
        const item = screen.getByRole("link", { name: label });
        expect(item).toHaveAttribute("aria-disabled", "true");
        expect(item).not.toHaveAttribute("href");
      }
    });
  });

  describe("given a project exists", () => {
    /** @scenario "With a project, every destination opens inside it" */
    it("links every destination into the project", () => {
      renderMenu({ project: PROJECT });

      const nav = screen.getByRole("link", { name: "Home" });
      expect(nav).toHaveAttribute("href", "/demo");
      expect(within(document.body).getByRole("link", { name: "Analytics" })).toHaveAttribute(
        "href",
        "/demo/analytics",
      );
      expect(anchorHrefs()).not.toContain("/auth/signin");
    });

    it("leaves the destinations enabled", () => {
      renderMenu({ project: PROJECT });

      expect(screen.getByRole("link", { name: "Trace Explorer" })).not.toHaveAttribute(
        "aria-disabled",
      );
    });
  });
});
