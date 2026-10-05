/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentDrawer } from "../CurrentDrawer";

const router = vi.hoisted(() => ({ asPath: "/" }));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: router.asPath,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ organizationRole: "MEMBER" }),
}));

vi.mock("../drawerRegistry", () => ({
  drawers: {
    automation: function MockAutomationDrawer({
      initialFilterQuery,
    }: {
      initialFilterQuery?: string;
    }) {
      return <div data-testid="automation-drawer">{initialFilterQuery}</div>;
    },
  },
}));

vi.mock("../ui/drawer", () => ({
  DrawerOffsetProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("<CurrentDrawer/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a trace-explorer link whose drawer query is followed by a #fragment", () => {
    /** @scenario "A trace-explorer link opens the automation drawer with only the filter it carries" */
    it("hands the drawer its props without the fragment", () => {
      router.asPath =
        "/traces?drawer.open=automation&drawer.initialFilterQuery=status%3Aerror#simplified";

      render(<CurrentDrawer />);

      expect(screen.getByTestId("automation-drawer")).toHaveTextContent(
        /^status:error$/,
      );
    });
  });

  describe("given drawer params parked after a lens fragment", () => {
    it("still opens the drawer they name", () => {
      router.asPath =
        "/traces#conversations?drawer.open=automation&drawer.initialFilterQuery=status%3Aok";

      render(<CurrentDrawer />);

      expect(screen.getByTestId("automation-drawer")).toHaveTextContent(
        /^status:ok$/,
      );
    });
  });
});
