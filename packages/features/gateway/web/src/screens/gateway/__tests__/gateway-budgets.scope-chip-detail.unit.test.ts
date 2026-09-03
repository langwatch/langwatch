/**
 * @vitest-environment node
 *
 * The Scope column moved the target's identifier and a group's member
 * count off the visible line and into the chip's tooltip. The tooltip
 * itself renders into a portal on hover, so what is pinned here is the
 * detail string that feeds it, together with `scopeChipTooltip` on the
 * chip side, which composes the line the reader actually sees.
 */
import { describe, expect, it } from "vitest";

import { scopeChipTooltip } from "@langwatch/authz-web/surfaces/scope-picker";
import { scopeChipDetail } from "../gateway-budgets.screen";

describe("scopeChipDetail", () => {
  describe("given a target with an identifier", () => {
    /** @scenario "Budget list Scope column renders the shared scope chip on one line" */
    it("carries the identifier so the visible line does not have to", () => {
      const detail = scopeChipDetail({
        kind: "ORGANIZATION",
        id: "org-1",
        name: "ACME",
        secondary: "acme-HXECRq",
      });
      expect(detail).toBe("acme-HXECRq");
      expect(scopeChipTooltip({ scopeType: "ORGANIZATION", name: "ACME", detail })).toBe(
        "Organization: ACME · acme-HXECRq",
      );
    });
  });

  describe("given a group target", () => {
    /** @scenario "Budget list keeps the per-member marker on a group scope" */
    it("carries the member count alongside the identifier", () => {
      const detail = scopeChipDetail({
        kind: "GROUP",
        id: "grp-1",
        name: "Engineering",
        secondary: "eng",
        memberCount: 4,
      });
      expect(detail).toBe("eng · 4 members");
      expect(
        scopeChipTooltip({
          scopeType: "GROUP",
          name: "Engineering",
          detail,
        }),
      ).toBe("Group: Engineering · eng · 4 members");
    });

    it("says member, singular, for a group of one", () => {
      expect(
        scopeChipDetail({
          kind: "GROUP",
          id: "grp-1",
          name: "Engineering",
          memberCount: 1,
        }),
      ).toBe("1 member");
    });
  });

  describe("given each scope kind the Budgets page can render", () => {
    /**
     * `ProviderScopeChips` falls back to the PROJECT style for any kind it
     * does not map, and the fallback still prints the name, so a chip that
     * lost its own icon and colour looks right on the page. The kind named
     * in the tooltip is the one place the mapping is observable.
     *
     * @scenario "Budget list Scope column renders the shared scope chip on one line"
     */
    it("names its own kind rather than falling back to Project", () => {
      const cases: Array<[Parameters<typeof scopeChipTooltip>[0], string]> = [
        [{ scopeType: "ORGANIZATION", name: "ACME" }, "Organization: ACME"],
        [{ scopeType: "TEAM", name: "Platform" }, "Team: Platform"],
        [{ scopeType: "PROJECT", name: "Web App" }, "Project: Web App"],
        [{ scopeType: "GROUP", name: "Engineering" }, "Group: Engineering"],
        [{ scopeType: "PRINCIPAL", name: "Ada Lovelace" }, "Person: Ada Lovelace"],
        [{ scopeType: "VIRTUAL_KEY", name: "Scenario CI" }, "Virtual key: Scenario CI"],
        [
          { scopeType: "ATTRIBUTED_USER", name: "prod-openai" },
          "Attributed user: prod-openai",
        ],
      ];
      for (const [entry, expected] of cases) {
        expect(scopeChipTooltip(entry)).toBe(expected);
      }
    });
  });

  describe("given a target with nothing to add", () => {
    it("leaves the tooltip at kind and name", () => {
      const detail = scopeChipDetail({
        kind: "PROJECT",
        id: "proj-1",
        name: "Web App",
      });
      expect(detail).toBeUndefined();
      expect(scopeChipTooltip({ scopeType: "PROJECT", name: "Web App", detail })).toBe(
        "Project: Web App",
      );
    });

    it("has no detail at all when there is no target", () => {
      expect(scopeChipDetail(null)).toBeUndefined();
    });
  });
});
