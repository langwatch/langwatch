// Personal project: family-local copy (PersonalSidebar nav). One per organization per user;
// organizationId required (otherwise unordered scan is undefined behavior).
export function findPersonalProject({
  organizations,
  userId,
  organizationId,
}: {
  organizations:
    | {
        id: string;
        teams?: {
          isPersonal?: boolean | null;
          ownerUserId?: string | null;
          projects?: { id: string; slug: string }[] | null;
        }[] | null;
      }[]
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
