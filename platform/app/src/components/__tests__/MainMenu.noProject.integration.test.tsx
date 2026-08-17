/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/project-scoped-destinations.feature
 *
 * A governance signup gets an organization and no project, and lands on chrome
 * that mounts the project rail anyway. Every project destination used to fall
 * back to the sign-in page, so a signed-in customer clicking Home was thrown
 * out of the product.
 *
 * The real SideMenuLink, CollapsibleMenuGroup, Tooltip and Link all render
 * here. Only genuine boundaries are stubbed (tRPC, the router, the hook whose
 * return value is this suite's input variable) because the last three bugs in
 * this area all hid behind a test that mocked the component under question.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectState = vi.hoisted(() => ({
  project: undefined as { id: string; slug: string } | undefined,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]" }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: projectState.project,
    organization: { id: "organization-1" },
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: {} }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getPendingItemsCount: { useQuery: () => ({ data: 0 }) },
    },
    ops: {
      getBadgeCounts: { useQuery: () => ({ data: undefined }) },
      getDashboardSnapshot: { useQuery: () => ({ data: undefined }) },
    },
    user: {
      isAdmin: { useQuery: () => ({ data: { isAdmin: false } }) },
    },
  },
}));

vi.mock("~/components/sidebar/UsageIndicator", () => ({
  UsageIndicator: () => null,
}));

import { MainMenu } from "../MainMenu";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>
    <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
  </MemoryRouter>
);

const renderMenu = () => render(<MainMenu />, { wrapper: Wrapper });

/** The grouped destinations only mount once their group is open. */
const expandSimulations = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Expand Simulations" }));
  await screen.findByRole("link", { name: "Scenarios" });
};

/** Every real anchor the rail renders, with the destination it points at. */
const anchorHrefs = () =>
  Array.from(document.querySelectorAll("a")).map((anchor) =>
    anchor.getAttribute("href"),
  );

describe("<MainMenu />", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("given the account has no project yet", () => {
    beforeEach(() => {
      projectState.project = undefined;
    });

    /** @scenario "No destination sends a signed-in person to sign in again" */
    it("sends nobody to the sign-in page", () => {
      renderMenu();

      expect(anchorHrefs()).not.toContain("/auth/signin");
    });

    it("marks a project destination unavailable instead of linking it", () => {
      renderMenu();

      const home = screen.getByRole("link", { name: "Home" });

      expect(home).toHaveAttribute("aria-disabled", "true");
      expect(home).not.toHaveAttribute("href");
    });

    /** @scenario "A destination inside a project says why it cannot be opened" */
    it("states why the destination cannot be opened", async () => {
      const user = userEvent.setup();
      renderMenu();

      await user.hover(screen.getByRole("link", { name: "Analytics" }));

      expect(
        await screen.findByText("Create a project first to open Analytics."),
      ).toBeTruthy();
    });

    /** @scenario "Destinations that do not need a project keep working" */
    it("keeps the destinations that do not need a project working", () => {
      renderMenu();

      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
        "href",
        "/settings",
      );
    });

    it("renders the grouped destinations without duplicate React keys", async () => {
      const user = userEvent.setup();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      renderMenu();
      await expandSimulations(user);

      // Both React key complaints: two siblings sharing a key, and siblings
      // with no key at all. A group whose items all resolve to the same
      // destination produces the first, and one keyed off a destination that
      // no longer exists produces the second.
      const keyWarnings = consoleError.mock.calls
        .map((call) => call.map(String).join(" "))
        .filter((message) => /same key|unique .?key/i.test(message));

      expect(keyWarnings).toEqual([]);
    });

    /** @scenario "Grouped destinations follow the same rule" */
    it("marks every grouped destination unavailable too", async () => {
      const user = userEvent.setup();
      renderMenu();
      await expandSimulations(user);

      for (const label of ["Scenarios", "Runs"]) {
        const item = screen.getByRole("link", { name: label });
        expect(item).toHaveAttribute("aria-disabled", "true");
        expect(item).not.toHaveAttribute("href");
      }
    });
  });

  describe("given a project exists", () => {
    beforeEach(() => {
      projectState.project = { id: "project-1", slug: "demo" };
    });

    /** @scenario "With a project, every destination opens inside it" */
    it("links every destination into the project", () => {
      renderMenu();

      const nav = screen.getByRole("link", { name: "Home" });
      expect(nav).toHaveAttribute("href", "/demo");
      expect(
        within(document.body).getByRole("link", { name: "Analytics" }),
      ).toHaveAttribute("href", "/demo/analytics");
      expect(anchorHrefs()).not.toContain("/auth/signin");
    });

    it("leaves the destinations enabled", () => {
      renderMenu();

      expect(
        screen.getByRole("link", { name: "Trace Explorer" }),
      ).not.toHaveAttribute("aria-disabled");
    });
  });
});
