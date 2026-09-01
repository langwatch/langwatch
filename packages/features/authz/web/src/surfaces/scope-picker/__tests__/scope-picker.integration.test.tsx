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
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { collapseRedundantScopes, ProviderScopeChips, scopeChipTooltip } from "../index";

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
