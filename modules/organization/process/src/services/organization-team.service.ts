import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  PERSONAL_TEAM_ARCHIVE_REFUSAL,
  PersonalTeamProtectedError,
  TeamNotFoundError,
  TeamSlugConflictError,
  createOrganizationTeamInputSchema,
  getOrganizationTeamInputSchema,
  getOrganizationTeamByIdInputSchema,
  getOrganizationTeamBySlugForMemberInputSchema,
  listOrganizationTeamsInputSchema,
  updateOrganizationTeamInputSchema,
  type CreateOrganizationTeamInput,
  type GetOrganizationTeamInput,
  type GetOrganizationTeamByIdInput,
  type GetOrganizationTeamBySlugForMemberInput,
  type ListOrganizationTeamsInput,
  type OrganizationTeam,
  type OrganizationTeamPage,
  type UpdateOrganizationTeamInput,
} from "@langwatch/organization-contract";

import type { TeamRepository } from "../repositories/team.repository.ts";
import type { TeamIdentity } from "./team-identity.service.ts";

/** Team reads and lifecycle in an organization: lookup, creation with a unique slug, archive. */
export class OrganizationTeamService {
  static create(deps: {
    teams: TeamRepository;
    authz: AuthzApi;
    teamIdentities: TeamIdentity;
  }): OrganizationTeamService {
    return new OrganizationTeamService(deps);
  }

  private constructor(
    private readonly deps: { teams: TeamRepository; authz: AuthzApi; teamIdentities: TeamIdentity },
  ) {}

  getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamInputSchema.parse(input);

    return this.deps.teams.get(parsed);
  }

  findPersonalTeamOwners(
    input: Readonly<{ organizationId: string; teamIds: readonly string[] }>,
  ): Promise<{ teamId: string; ownerUserId: string | null }[]> {
    if (input.teamIds.length === 0) return Promise.resolve([]);
    return this.deps.teams.findPersonalTeamOwners(input);
  }

  listTeams(input: ListOrganizationTeamsInput): Promise<OrganizationTeamPage> {
    return this.deps.teams.listPage(listOrganizationTeamsInputSchema.parse(input));
  }

  async createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = createOrganizationTeamInputSchema.parse(input);
    const identity = this.deps.teamIdentities.createTeam({ name: parsed.name });
    const slugTaken = await this.deps.teams
      .getBySlug({ organizationId: parsed.organizationId, slug: identity.slug })
      .then(
        () => true,
        (error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "team_not_found") return false;
          throw error;
        },
      );
    if (slugTaken) {
      throw new TeamSlugConflictError();
    }

    return this.deps.teams.create({
      organizationId: parsed.organizationId,
      name: parsed.name,
      ...identity,
    });
  }

  updateTeam(input: UpdateOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = updateOrganizationTeamInputSchema.parse(input);

    return this.deps.teams.update(parsed);
  }

  async archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamInputSchema.parse(input);
    const team = await this.deps.teams.get(parsed);
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_ARCHIVE_REFUSAL);
    }

    return this.deps.teams.archive(parsed);
  }

  getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamByIdInputSchema.parse(input);

    return this.deps.teams.getById(parsed.teamId);
  }

  async getTeamBySlugForMember(
    input: GetOrganizationTeamBySlugForMemberInput,
  ): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamBySlugForMemberInputSchema.parse(input);
    const team = await this.deps.teams.getBySlug(parsed);
    const bindings = await this.deps.authz.listTeamMemberBindings({
      organizationId: parsed.organizationId,
      teamIds: [team.id],
    });
    if (!(bindings.get(team.id) ?? []).some(({ userId }) => userId === parsed.userId)) {
      throw new TeamNotFoundError(team.id);
    }

    return team;
  }
}
