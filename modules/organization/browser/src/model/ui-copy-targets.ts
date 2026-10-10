/**
 * Which projects a thing may be replicated into: every project on a team the
 * reader belongs to, graded by the reader's own effective permissions IN THAT
 * PROJECT, as main's `useProjectsForCopy` graded them. A closed project stays listed.
 */

import { permissionSatisfiedBy } from "@langwatch/authorization";
import type { UiCopyTarget } from "@langwatch/browser-host/capabilities";
import type { UiScopeOrganization } from "@langwatch/organization-contract";

/** A candidate before any permission is asked of it. */
export type UiCopyCandidate = Omit<UiCopyTarget, "mayCreate">;

export function uiCopyCandidates({
  organizations,
  userId,
}: {
  organizations: readonly UiScopeOrganization[];
  userId: string | undefined;
}): UiCopyCandidate[] {
  if (!userId) return [];

  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => {
      if (!team.members?.some((member) => member.userId === userId)) return [];

      return team.projects.map((project) => ({
        projectId: project.id,
        projectSlug: project.slug,
        label: [organization.name, team.name, project.name]
          .filter((part) => part !== void 0)
          .join(" / "),
      }));
    }),
  );
}

/** A project whose grants have not landed reads closed: a grant never flickers open. */
export function uiCopyTargets({
  candidates,
  grantsOf,
  permission,
}: {
  candidates: readonly UiCopyCandidate[];
  grantsOf: (projectId: string) => readonly string[] | undefined;
  permission: string;
}): UiCopyTarget[] {
  return candidates.map((candidate) => ({
    ...candidate,
    mayCreate: permissionSatisfiedBy({
      granted: new Set(grantsOf(candidate.projectId) ?? []),
      requested: permission,
    }),
  }));
}
