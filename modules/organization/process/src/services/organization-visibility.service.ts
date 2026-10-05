/**
 * What one person is allowed to SEE of the organizations they belong to:
 * `organization.getAll` redacts per viewer which credentials/colleagues
 * travel; the member picker shows names to everybody, addresses only to an administrator.
 */

import type { AuthzApi, AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import {
  OrganizationNotFoundError,
  MemberNotFoundError,
  type FullyLoadedOrganization,
  type OrganizationCaller,
  type OrganizationWithMembersAndTheirTeams,
} from "@langwatch/organization-contract";

import { userCanOpenTeam } from "../rules/team-visibility.rules.ts";
import { OrganizationMembershipService } from "./organization-membership.service.ts";
import type { OrganizationSettingsSecret } from "./organization.service.ts";

/** The demo organization's person and project, or empty strings when unset. */
export type OrganizationDemoProject = Readonly<{ userId: string; projectId: string }>;

/** What this service reads the organization rows through. */
export interface OrganizationVisibilityReader {
  getAllForUser(
    input: Readonly<{
      userId: string;
      isDemo: boolean;
      demoProjectUserId: string;
      demoProjectId: string;
    }>,
  ): Promise<FullyLoadedOrganization[]>;
  findOrganizationWithMembers(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean; userId: string }>,
  ): Promise<OrganizationWithMembersAndTheirTeams | null>;
  findMemberById(
    input: Readonly<{ organizationId: string; userId: string; currentUserId: string }>,
  ): Promise<OrganizationWithMembersAndTheirTeams["members"][number] | null>;
}

export interface OrganizationVisibilityDependencies {
  readonly reader: OrganizationVisibilityReader;
  readonly permissions: AuthzApi;
  readonly secrets: OrganizationSettingsSecret;
  readonly demoProject: OrganizationDemoProject;
}

/** Whether an organization-scoped ADMIN binding makes this viewer an administrator. */
function isAdminByBinding(input: {
  bindings: readonly AuthzBindingForSynthesis[];
  organizationId: string;
}): boolean {
  return input.bindings.some(
    (binding) =>
      binding.organizationId === input.organizationId &&
      binding.scopeType === "ORGANIZATION" &&
      binding.role === "ADMIN",
  );
}

export class OrganizationVisibilityService {
  static create(dependencies: OrganizationVisibilityDependencies): OrganizationVisibilityService {
    return new OrganizationVisibilityService(dependencies);
  }

  private constructor(private readonly deps: OrganizationVisibilityDependencies) {}

  /**
   * Every organization this person can reach, redacted for them. The shell's
   * first call: the project switcher, the active scope and every settings
   * screen are read off this one answer.
   */
  async listVisible(
    input: Readonly<{ isDemo: boolean }>,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]> {
    const userId = by.id;
    const demo = this.deps.demoProject;
    const demoProjectUserId = input.isDemo ? demo.userId : "";
    const demoProjectId = input.isDemo ? demo.projectId : "";

    const organizations = await this.deps.reader.getAllForUser({
      userId,
      isDemo: input.isDemo,
      demoProjectUserId,
      demoProjectId,
    });

    // Team- and organization-scoped bindings, direct or through a group, so a
    // person whose only access is a binding still sees the teams it reaches.
    const organizationIds = organizations.map((organization) => organization.id);
    const bindings =
      organizationIds.length > 0
        ? await this.deps.permissions.listBindingsForSynthesis({ orgIds: organizationIds, userId })
        : [];

    for (const organization of organizations) {
      this.#redactStoredCredentials(organization);
      this.#narrowToViewer({
        organization,
        userId,
        demoProjectUserId,
        demoProjectId,
        isDemo: input.isDemo,
        bindings,
      });
    }

    return organizations;
  }

  /**
   * One organization with its members and their teams, as the pickers read it.
   * Names travel to everybody; an address and somebody else's personal
   * workspace travel only to an administrator.
   */
  async getWithMembersForPicker(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams> {
    const organization = await this.deps.reader.findOrganizationWithMembers({
      ...input,
      userId: by.id,
    });

    if (!organization) throw new OrganizationNotFoundError(input.organizationId);

    const canManage = await this.#probeOrganization({
      userId: by.id,
      organizationId: input.organizationId,
    });

    if (canManage) return organization;

    for (const member of organization.members ?? []) {
      if (member.user.id !== by.id) member.user.email = null;

      // The existence of somebody else's personal workspace is itself private;
      // the caller's own stays, because they belong to it.
      if (member.user.teamMemberships) {
        member.user.teamMemberships = member.user.teamMemberships.filter(
          (membership) => !membership.team.isPersonal || membership.team.ownerUserId === by.id,
        );
      }
    }

    return organization;
  }

  /** One member's full record, refused by name where there is none. */
  async getMemberOrRefuse(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams["members"][number]> {
    const member = await this.deps.reader.findMemberById({ ...input, currentUserId: by.id });

    if (!member) throw new MemberNotFoundError(input.userId);

    return member;
  }

  #probeOrganization(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.deps.permissions.hasPermission({
      userId: input.userId,
      permission: "organization:manage",
      organizationId: input.organizationId,
    });
  }

  /**
   * A query never carries a credential, because every query is cached, to the
   * browser's disk too. The S3 secret, the project base key and the LangWatchQL
   * key go to nobody; the base key is revealed by a mutation.
   */
  #redactStoredCredentials(organization: FullyLoadedOrganization): void {
    const decrypt = (value: string) => this.deps.secrets.decrypt(value);

    for (const project of organization.teams.flatMap((team) => team.projects)) {
      if (project.s3AccessKeyId) project.s3AccessKeyId = decrypt(project.s3AccessKeyId);
      project.s3SecretAccessKey = null;
      if (project.s3Endpoint) project.s3Endpoint = decrypt(project.s3Endpoint);

      project.apiKey = "";
      project.lwqlKey = "";
    }

    if (organization.s3AccessKeyId)
      organization.s3AccessKeyId = decrypt(organization.s3AccessKeyId);
    organization.s3SecretAccessKey = null;
    if (organization.s3Endpoint) organization.s3Endpoint = decrypt(organization.s3Endpoint);

    // The row still carries the retired Elasticsearch columns, kept for deploy
    // safety until a migration drops them. The stored ciphertext never ships.
    organization.elasticsearchNodeUrl = null;
    organization.elasticsearchApiKey = null;
    organization.useCustomElasticsearch = false;
    // The uploaded licence key is shown once at upload and never read back.
    organization.license = null;
  }

  /**
   * The organization as this one viewer sees it: their own membership row,
   * their own team memberships, and the teams a binding reaches even where no
   * `TeamUser` row exists.
   */
  #narrowToViewer(input: {
    organization: FullyLoadedOrganization;
    userId: string;
    demoProjectUserId: string;
    demoProjectId: string;
    isDemo: boolean;
    bindings: readonly AuthzBindingForSynthesis[];
  }): void {
    const { organization, userId, demoProjectUserId, demoProjectId, isDemo, bindings } = input;
    const isDemoOrganization =
      isDemo &&
      organization.teams.some((team) =>
        team.projects.some((project) => project.id === demoProjectId),
      );

    organization.members = organization.members.filter(
      (member) => member.userId === userId || member.userId === demoProjectUserId,
    );

    // A person can be an administrator through the legacy membership row OR
    // through an organization-scoped ADMIN binding. The binding is
    // authoritative where present, so a stale MEMBER row cannot shadow it.
    const adminByBinding = isAdminByBinding({ bindings, organizationId: organization.id });
    if (adminByBinding) {
      const own = organization.members[0];
      organization.members = own
        ? [{ ...own, role: "ADMIN" }, ...organization.members.slice(1)]
        : [
            {
              userId,
              organizationId: organization.id,
              role: "ADMIN",
            } as (typeof organization.members)[number],
          ];
    }

    const organizationRole = organization.members.find((member) => member.userId === userId)?.role;

    organization.teams = organization.teams.filter((team) => {
      team.members = team.members.filter(
        (member) => member.userId === userId || member.userId === demoProjectUserId,
      );
      team.members = OrganizationMembershipService.enrichTeamWithGrants({
        team,
        userId,
        userGrants: [...bindings],
        organizationId: organization.id,
      }).members;

      if (isDemoOrganization) return true;
      return userCanOpenTeam({ team, userId, organizationRole });
    });

    if (!isDemoOrganization) return;

    organization.teams = organization.teams.flatMap((team) => {
      if (!team.projects.some((project) => project.id === demoProjectId)) return [];

      team.projects = team.projects.filter((project) => project.id === demoProjectId);
      team.members = team.members.filter(
        (member) => member.userId === demoProjectUserId || member.userId === userId,
      );
      return [team];
    });
  }
}
