/**
 * The organization graph the scope tests resolve against, shaped the way
 * `organization.getAll` returns it.
 *
 * The personal team is listed BEFORE the shared one on purpose: that ordering
 * is what let a personal workspace win the ambient context, so a fixture that
 * quietly sorted the shared team first would let the tests pass without
 * meaning anything. Ported from the application's own fixture for the same
 * reason the resolution was — a second graph that disagreed would prove
 * nothing about the rules being carried.
 */

import type { UiScopeOrganization, UiScopeTeam } from "../../src/model/ui-scope";

export const JANE = "user-jane";

export const PERSONAL_TEAM: UiScopeTeam = {
  id: "team-personal",
  slug: "personal-jane",
  isPersonal: true,
  ownerUserId: JANE,
  members: [{ userId: JANE }],
  projects: [{ id: "proj-personal", slug: "personal-jane-abc123", name: "Personal Workspace" }],
};

export const SHARED_TEAM: UiScopeTeam = {
  id: "team-shared",
  slug: "acme",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: JANE }],
  projects: [{ id: "proj-app", slug: "acme-app", name: "ACME App" }],
};

/** One organization holding exactly the teams given, personal team first. */
export function organizationWith({
  teams,
  organizationRole = "ADMIN",
}: {
  teams: readonly UiScopeTeam[];
  organizationRole?: string;
}): readonly UiScopeOrganization[] {
  return [
    {
      id: "org-acme",
      slug: "acme",
      members: [{ role: organizationRole }],
      teams,
    },
  ];
}

export const NOTHING_REMEMBERED = {
  organizationId: "",
  teamId: "",
  projectSlug: "",
} as const;
