/**
 * Resolves the signed-in user's personal project from the organizations
 * payload: the personal team owned by the user carries exactly one personal
 * project.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/utils/personalProject.ts`, which
 * stays for `PersonalSidebar`'s navigation links. Thirty lines of traversal over
 * a graph shape this package already declares on its host port, and the
 * predicate — the personal team OWNED BY THIS USER, never merely a personal team
 * — is the same one `/api/auth/cli/approve` authorizes with, which is why it is
 * worth having exactly once on each side rather than approximated.
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
