/**
 * ADR-177 block F: an admin opens an aggregate on purpose, so a remembered
 * selection never lands on one and the resolution never remembers one.
 *
 * @see specs/governance/aggregate-project.feature
 */
import type { UiScopeTeam } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { resolveUiScope, uiScopeSelectionWrites } from "../ui-scope-resolution";
import { JANE, organizationWith } from "./ui-scope-graph";

const ORDINARY = { id: "proj-app", slug: "support-bot", name: "Support Bot", kind: "application" };
const AGGREGATE = {
  id: "proj-aggregate",
  slug: "company-traces",
  name: "Company Traces",
  kind: "aggregate",
};

const teamOf = (id: string, projects: UiScopeTeam["projects"]): UiScopeTeam => ({
  id,
  slug: id,
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: JANE }],
  projects,
});

describe.each([
  {
    layout: "the aggregate on a team of its own",
    teams: [teamOf("team-company", [AGGREGATE]), teamOf("team-support", [ORDINARY])],
    rememberedTeamId: "team-company",
  },
  {
    layout: "the aggregate beside the ordinary project",
    teams: [teamOf("team-support", [AGGREGATE, ORDINARY])],
    rememberedTeamId: "team-support",
  },
])("given an admin's organisation with $layout", ({ teams, rememberedTeamId }) => {
  const organizations = organizationWith({ teams });

  describe("when the remembered selection names the aggregate", () => {
    /** @scenario "Landing never resolves to an aggregate from a remembered selection" */
    it("lands on the ordinary project and remembers it instead", () => {
      const selection = {
        organizationId: "org-acme",
        teamId: rememberedTeamId,
        projectSlug: AGGREGATE.slug,
      };
      const resolved = resolveUiScope({
        route: { isPersonalScopeRoute: false },
        organizations,
        userId: JANE,
        selection,
      });

      expect(resolved.project?.id).toBe(ORDINARY.id);
      expect(uiScopeSelectionWrites({ resolved, selection })).toContainEqual({
        key: "projectSlug",
        value: ORDINARY.slug,
      });
    });
  });

  describe("when the address names the aggregate", () => {
    /** @scenario "Landing never resolves to an aggregate from a remembered selection" */
    it("opens the aggregate and does not remember it", () => {
      const selection = {
        organizationId: "org-acme",
        teamId: "team-support",
        projectSlug: ORDINARY.slug,
      };
      const resolved = resolveUiScope({
        route: { isPersonalScopeRoute: false, projectParam: AGGREGATE.slug },
        organizations,
        userId: JANE,
        selection,
      });

      expect(resolved.project?.id).toBe(AGGREGATE.id);
      expect(uiScopeSelectionWrites({ resolved, selection })).toEqual([]);
    });
  });
});
