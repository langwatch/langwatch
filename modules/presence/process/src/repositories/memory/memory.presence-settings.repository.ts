import {
  type PresenceProjectSettings,
  PresenceSettingsRepository,
} from "../presence-settings.repository.ts";

export type MemoryPresenceProjectRow = { teamId: string; presenceEnabled: boolean };
export type MemoryPresenceTeamRow = { organizationId: string };
export type MemoryPresenceOrganizationRow = { presenceEnabled: boolean };

/** In-memory twin of the rows project and organization hold; a test hands them in. */
export class MemoryPresenceSettingsRepository extends PresenceSettingsRepository {
  private constructor(
    private readonly rows: Readonly<{
      projects: Map<string, MemoryPresenceProjectRow>;
      teams: Map<string, MemoryPresenceTeamRow>;
      organizations: Map<string, MemoryPresenceOrganizationRow>;
    }>,
  ) {
    super();
  }

  static create({
    projects = new Map<string, MemoryPresenceProjectRow>(),
    teams = new Map<string, MemoryPresenceTeamRow>(),
    organizations = new Map<string, MemoryPresenceOrganizationRow>(),
  }: {
    projects?: Map<string, MemoryPresenceProjectRow>;
    teams?: Map<string, MemoryPresenceTeamRow>;
    organizations?: Map<string, MemoryPresenceOrganizationRow>;
  } = {}): MemoryPresenceSettingsRepository {
    return new MemoryPresenceSettingsRepository({ projects, teams, organizations });
  }

  async getSettings({ projectId }: { projectId: string }): Promise<PresenceProjectSettings> {
    const project = this.rows.projects.get(projectId);
    if (!project) return { outcome: "unknown" };
    const team = this.rows.teams.get(project.teamId);
    if (!team) return { outcome: "unknown" };
    const organization = this.rows.organizations.get(team.organizationId);
    if (!organization) return { outcome: "unknown" };
    return {
      outcome: "known",
      projectEnabled: project.presenceEnabled,
      organizationEnabled: organization.presenceEnabled,
    };
  }
}
