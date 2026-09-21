/**
 * Resolves the signed-in user's personal project from the organizations
 * payload: the personal team owned by the user carries exactly one personal
 * project. Shared by PersonalSidebar (personal nav links) and the /cli/auth
 * first-trace watcher, so the traversal lives in one place.
 *
 * A personal workspace belongs to ONE organization — PersonalWorkspaceService
 * .ensure takes an organizationId and creates a workspace per organization —
 * so a user in several organizations owns several personal projects and the
 * caller has to name which organization it is asking about. `organizationId`
 * is required rather than optional for that reason: scanning every
 * organization returned whichever personal team came first in a list the
 * server sends unordered, which is not a choice any caller means to make.
 */
export function findPersonalProject({
  organizations,
  userId,
  organizationId,
}: {
  organizations:
    | Array<{
        id: string;
        teams?: Array<{
          isPersonal?: boolean | null;
          ownerUserId?: string | null;
          projects?: Array<{ id: string; slug: string }> | null;
        }> | null;
      }>
    | undefined;
  userId: string | null | undefined;
  /** The organization the caller is showing. Nothing resolves without it. */
  organizationId: string | null | undefined;
}): { id: string; slug: string } | null {
  if (!userId || !organizationId) return null;
  const organization = organizations?.find((org) => org.id === organizationId);
  const team = organization?.teams?.find(
    (candidate) =>
      candidate.isPersonal &&
      candidate.ownerUserId === userId &&
      !!candidate.projects?.[0],
  );
  const project = team?.projects?.[0];
  return project ? { id: project.id, slug: project.slug } : null;
}
