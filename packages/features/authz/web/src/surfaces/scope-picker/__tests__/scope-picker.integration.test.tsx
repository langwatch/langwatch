/**
 * @vitest-environment jsdom
 *
 * Scope selection as a shared surface.
 *
 * The picker and the chips left `platform/app/src/components/settings` so the
 * governance tool catalogue and, next, the gateway can both render them without
 * either owning the other's copy. What matters after a move like this is that
 * the two behaviours a caller relies on came with it: the chips say which KIND
 * of scope they name, and the picker collapses a selection that is already
 * implied by a broader one rather than offering both.
 *
 * THREE SCENARIOS ARRIVED WITH THE API KEY FAMILY, and they belong here rather
 * than with the callers. `/cli/auth` and the API Keys page used to assert the
 * picker's empty label and the filter's option list against their own page
 * suites, because the components were `platform/app`'s and had no home of their
 * own. The surface owns those behaviours now, so it owns their tests: a caller
 * asserting them again would be testing this package through a page.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  collapseRedundantScopes,
  ProviderScopeChips,
  ScopeChipPicker,
  ScopeFilter,
  scopeChipTooltip,
} from "../index";

afterEach(cleanup);

const withChakra = (node: React.ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

describe("given a set of scope chips", () => {
  describe("when a chip names something", () => {
    it("shows the name and says the kind on hover", () => {
      withChakra(
        <ProviderScopeChips
          scopes={[{ scopeType: "TEAM", scopeId: "team_1", name: "Platform" }]}
        />,
      );

      expect(screen.getByText("Platform")).toBeDefined();
      expect(scopeChipTooltip({ scopeType: "TEAM", name: "Platform" })).toBe("Team: Platform");
    });
  });

  describe("when a caller has the scope type but no name", () => {
    it("falls back to the bare kind rather than an empty chip", () => {
      expect(scopeChipTooltip({ scopeType: "PROJECT" })).toContain("Project");
    });
  });

  describe("when identifying detail would crowd the chip", () => {
    it("moves it into the tooltip after the name", () => {
      expect(scopeChipTooltip({ scopeType: "VIRTUAL_KEY", name: "ci", detail: "lw_sk_ab" })).toBe(
        "Virtual key: ci · lw_sk_ab",
      );
    });
  });
});

describe("given a selection that already names a team and a project", () => {
  describe("when the whole organization is then picked", () => {
    it("keeps the organization and drops what it already implies", () => {
      const previous = [
        { scopeType: "TEAM" as const, scopeId: "team_1" },
        { scopeType: "PROJECT" as const, scopeId: "project_1" },
      ];

      const collapsed = collapseRedundantScopes(
        [...previous, { scopeType: "ORGANIZATION", scopeId: "org_1" }],
        previous,
        {
          organizationId: "org_1",
          availableProjects: [{ id: "project_1", teamId: "team_1" }],
        },
      );

      expect(collapsed).toEqual([{ scopeType: "ORGANIZATION", scopeId: "org_1" }]);
    });
  });

  describe("when nothing new was picked", () => {
    it("leaves the selection exactly as it was", () => {
      const previous = [
        { scopeType: "TEAM" as const, scopeId: "team_1" },
        { scopeType: "PROJECT" as const, scopeId: "project_1" },
      ];

      expect(
        collapseRedundantScopes(previous, previous, {
          organizationId: "org_1",
          availableProjects: [{ id: "project_1", teamId: "team_1" }],
        }),
      ).toEqual(previous);
    });
  });
});

const AVAILABLE = {
  organization: { id: "org_1", name: "ACME" },
  teams: [{ id: "team_1", name: "Platform" }],
  projects: [{ id: "project_1", name: "Web App", teamId: "team_1" }],
};

describe("given a single-select picker with nothing chosen", () => {
  describe("when it renders", () => {
    /** @scenario zero selected reads "None selected", never "Multiple" */
    it("says None selected rather than counting an empty selection", () => {
      withChakra(
        <ScopeChipPicker
          variant="single-select"
          label=""
          placeholder="None selected"
          allowedScopeTypes={["PROJECT"]}
          organizationId="org_1"
          availableProjects={[{ id: "project_1", name: "Web App", teamId: "team_1" }]}
          availableTeams={[{ id: "team_1", name: "Platform" }]}
          value={[]}
          onChange={() => undefined}
          showSummary={false}
        />,
      );

      // "Multiple" is what a count-based label says for anything other than
      // exactly one, and it read as though something was already picked.
      expect(screen.getByText("None selected")).toBeDefined();
      expect(screen.queryByText("Multiple")).toBeNull();
    });
  });
});

describe("given the scope filter", () => {
  describe("when its options are opened", () => {
    /** @scenario Scope filter dropdown offers the same options as the model-providers page */
    it("offers everything the caller can see, from the one list every page passes it", async () => {
      const user = userEvent.setup();
      withChakra(
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
      withChakra(
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
