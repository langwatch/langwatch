/**
 * The organization graph the scope tests resolve against, shaped the way
 * `organization.getAll` returns it.
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
