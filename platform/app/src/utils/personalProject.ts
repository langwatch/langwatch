type PersonalProjectTeam = {
  isPersonal?: boolean | null;
  ownerUserId?: string | null;
  projects?: Array<{ id: string; slug: string }> | null;
};

type PersonalProjectOrganization = {
  teams?: Array<PersonalProjectTeam> | null;
};

function personalProjectOfTeam({
  team,
  userId,
}: {
  team: PersonalProjectTeam;
  userId: string;
}): { id: string; slug: string } | null {
  if (!team.isPersonal || team.ownerUserId !== userId) return null;
  const project = team.projects?.[0];
  return project ? { id: project.id, slug: project.slug } : null;
}

function personalProjectOfOrganization({
  organization,
  userId,
}: {
  organization: PersonalProjectOrganization;
  userId: string;
}): { id: string; slug: string } | null {
  for (const team of organization.teams ?? []) {
    const project = personalProjectOfTeam({ team, userId });
    if (project) return project;
  }
  return null;
}

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
  organizations: Array<PersonalProjectOrganization> | undefined;
  userId: string | null | undefined;
}): { id: string; slug: string } | null {
  if (!userId || !organizations) return null;
  for (const organization of organizations) {
    const project = personalProjectOfOrganization({ organization, userId });
    if (project) return project;
  }
  return null;
}
