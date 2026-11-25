/** The organization and project a CLI login is for, defaulted and reset per organization. */

import { useEffect, useMemo, useState } from "react";

import type { ApiKeyOrganization } from "../model/api-key-host.ts";
import { resolveCliAuthProjects } from "../model/cli-auth-projects.ts";

export function useCliLoginTarget({
  organizations,
  lastProjectSlug,
  currentUserId,
}: {
  organizations: ApiKeyOrganization[] | undefined;
  lastProjectSlug: string | null;
  currentUserId: string | null;
}) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Auto-pick the first org; the chooser is only needed when the user is in 2+.
  const firstOrgId = organizations?.[0]?.id;
  useEffect(() => {
    if (firstOrgId && !selectedOrgId) setSelectedOrgId(firstOrgId);
  }, [firstOrgId, selectedOrgId]);

  const selectedOrg = useMemo(
    () => organizations?.find((o) => o.id === selectedOrgId),
    [organizations, selectedOrgId],
  );

  // Shared projects grouped by team, plus the caller's personal project; the hidden
  // governance tenancy project is never offered. Default: last project worked in,
  // else the sole shared project, else personal.
  const { projects, teams, personalProject, defaultProjectId } = useMemo(
    () => resolveCliAuthProjects({ teams: selectedOrg?.teams, lastProjectSlug, currentUserId }),
    [selectedOrg, lastProjectSlug, currentUserId],
  );

  const offeredProjects = useMemo(
    () => [...projects, ...(personalProject ? [personalProject] : [])],
    [projects, personalProject],
  );

  // Non-personal teams, in display order: the reader's personal workspace is
  // offered as its project instead.
  const sharedTeams = useMemo(
    () =>
      (selectedOrg?.teams ?? [])
        .filter((team) => !team.isPersonal)
        .map((team) => ({ id: team.id, name: team.name })),
    [selectedOrg],
  );

  useEffect(() => {
    setSelectedProjectId(null);
  }, [selectedOrgId]);
  useEffect(() => {
    if (defaultProjectId && !selectedProjectId) setSelectedProjectId(defaultProjectId);
  }, [defaultProjectId, selectedProjectId]);

  return {
    selectedOrgId,
    setSelectedOrgId,
    selectedOrg,
    selectedProjectId,
    setSelectedProjectId,
    projectsForOrg: projects,
    teamsForOrg: teams,
    personalProject,
    offeredProjects,
    sharedTeams,
    /** No shared project exists, so the reader's personal one was preselected. */
    isPersonalFallback:
      projects.length === 0 && !!personalProject && selectedProjectId === personalProject.id,
  };
}
