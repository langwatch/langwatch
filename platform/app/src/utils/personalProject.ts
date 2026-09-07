/**
 * Resolves the signed-in user's personal project from the organizations
 * payload: the personal team owned by the user carries exactly one personal
 * project. Shared by PersonalSidebar (personal nav links) and the /cli/auth
 * first-trace watcher, so the traversal lives in one place.
 */
export function findPersonalProject({
  organizations,
  userId,
}: {
  organizations:
    | Array<{
        teams?: Array<{
          isPersonal?: boolean | null;
          ownerUserId?: string | null;
          projects?: Array<{ id: string; slug: string }> | null;
        }> | null;
      }>
    | undefined;
  userId: string | null | undefined;
}): { id: string; slug: string } | null {
  if (!userId || !organizations) return null;
  for (const org of organizations) {
    for (const team of org.teams ?? []) {
      if (team.isPersonal && team.ownerUserId === userId) {
        const project = team.projects?.[0];
        if (project) return { id: project.id, slug: project.slug };
      }
    }
  }
  return null;
}
