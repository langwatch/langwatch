/** @vitest-environment jsdom */
// Read-side scope filter: one option list for every page, reachable by keyboard.
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ScopeFilter } from "../src/components/scope-filter.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const AVAILABLE = {
  organization: { id: "org_1", name: "ACME" },
  teams: [{ id: "team_1", name: "Platform" }],
  projects: [{ id: "project_1", name: "Web App", teamId: "team_1" }],
};

describe("given the scope filter", () => {
  describe("when its options are opened", () => {
    /** @scenario Scope filter dropdown offers the same options as the model-providers page */
    it("offers everything the caller can see, from the one list every page passes it", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={() => undefined}
          available={AVAILABLE}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );

      await user.click(screen.getByTestId("scope-filter"));
      // The named scopes live one level down, behind "More Scopes" — the two
      // ambient picks and "All you can see" are the top level.
      expect(await screen.findByTestId("filter-all")).toBeDefined();
      expect(screen.getByTestId("filter-this-team")).toBeDefined();
      expect(screen.getByTestId("filter-this-project")).toBeDefined();
      await user.click(screen.getByTestId("filter-more-scopes"));

      // One surface, one option list: the API Keys page and the model-providers
      // page pass the same three-field shape and therefore see the same menu.
      expect(await screen.findByText("ACME")).toBeDefined();
      expect(screen.getByText("Platform")).toBeDefined();
      expect(screen.getByText("Web App")).toBeDefined();
    });

    /** @scenario Scope filter dropdown is keyboard navigable */
    it("is a menu, so arrow keys and Enter reach every option", async () => {
      const user = userEvent.setup();
      const picked: unknown[] = [];
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={(next) => picked.push(next)}
          available={AVAILABLE}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );

      // Keyboard navigation is Ark's, provided by the Menu this is built from —
      // which is exactly why the platform guard asserted the component USED a
      // Menu. Driving it is stronger: the trigger takes focus, opens on Enter,
      // and the highlighted option is chosen without a pointer ever moving.
      await user.tab();
      expect(screen.getByTestId("scope-filter")).toHaveFocus();
      await user.keyboard("{Enter}");

      // Opening it with the keyboard is the half that has to be a Menu; the
      // options are then reachable because Ark manages the highlight for them.
      const options = await screen.findAllByRole("menuitem");
      expect(options.length).toBeGreaterThan(1);

      await user.keyboard("{ArrowDown}");
      await user.keyboard("{Enter}");
      expect(picked.length).toBeGreaterThan(0);
    });
  });
});
