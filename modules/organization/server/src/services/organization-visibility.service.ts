/**
 * What one person is allowed to SEE of the organizations they belong to.
 *
 * Two reads live here, and both are redaction rather than retrieval: the
 * shell's own `organization.getAll`, which decides per viewer which stored
 * credentials and which colleagues travel, and the member picker, which shows
 * names to everybody and addresses only to an administrator.
 */

import type { AuthzApi, AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import type {
  FullyLoadedOrganization,
  OrganizationCaller,
  OrganizationWithMembersAndTheirTeams,
} from "@langwatch/organization-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";

import { OrganizationMembershipService } from "./organization-membership.service.ts";
import type { OrganizationDemoProject } from "../app/organization.members.ts";
import type { OrganizationSettingsSecret } from "../app/organization.members.ts";
import { MemberNotFoundError } from "@langwatch/organization-contract";

/**
 * How many permission questions one organization asks at once. Bounded rather
 * than a fan-out: an organization's project list can be long, and one decision
 * per project opened at once would starve the connection pool the request is
 * already running on.
 */
const PERMISSION_PROBE_CONCURRENCY = 8;

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

    const manageable = await this.#manageableOrganizationIds({ organizations, userId });
    const updatableProjects = await this.#updatableProjectIds({ organizations, userId });

    for (const organization of organizations) {
      this.#redactStoredCredentials({
        organization,
        canManage: manageable.has(organization.id),
        isDemo: input.isDemo,
        updatable: updatableProjects.get(organization.id) ?? new Map<string, boolean>(),
      });
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

  #probeProject(input: { userId: string; projectId: string }): Promise<boolean> {
    return this.deps.permissions.hasPermission({
      userId: input.userId,
      permission: "project:update",
      projectId: input.projectId,
    });
  }

  /** Which of these organizations the caller may administer. */
  async #manageableOrganizationIds(input: {
    organizations: readonly FullyLoadedOrganization[];
    userId: string;
  }): Promise<ReadonlySet<string>> {
    const manageable = new Set<string>();

    for (const organization of input.organizations) {
      const canManage = await this.#probeOrganization({
        userId: input.userId,
        organizationId: organization.id,
      });
      if (canManage) manageable.add(organization.id);
    }

    return manageable;
  }

  /**
   * Which projects the caller may change, per organization. One batched
   * resolution per organization rather than one check per project: a scoped
   * check costs several queries, so a per-project fan-out would scale with the
   * organization's project count.
   */
  async #updatableProjectIds(input: {
    organizations: readonly FullyLoadedOrganization[];
    userId: string;
  }): Promise<ReadonlyMap<string, ReadonlyMap<string, boolean>>> {
    const byOrganization = new Map<string, ReadonlyMap<string, boolean>>();

    for (const organization of input.organizations) {
      const projectIds = organization.teams.flatMap((team) =>
        team.projects.map((project) => project.id),
      );
      if (projectIds.length === 0) continue;

      const decisions = await mapWithConcurrency(projectIds, async (projectId) => {
        const permitted = await this.#probeProject({ userId: input.userId, projectId });
        return [projectId, permitted] as const;
      });
      byOrganization.set(organization.id, new Map(decisions));
    }

    return byOrganization;
  }

  /**
   * The stored credentials, decided per viewer. The S3 secret and the project
   * base key are write credentials: they go only to somebody who can change
   * the thing they belong to, rather than to everybody on the trust that no
   * screen renders them. The LangWatchQL key goes to nobody at all.
   */
  #redactStoredCredentials(input: {
    organization: FullyLoadedOrganization;
    canManage: boolean;
    isDemo: boolean;
    updatable: ReadonlyMap<string, boolean>;
  }): void {
    const { organization, canManage, isDemo, updatable } = input;
    const decrypt = (value: string) => this.deps.secrets.decrypt(value);

    for (const project of organization.teams.flatMap((team) => team.projects)) {
      if (project.s3AccessKeyId) project.s3AccessKeyId = decrypt(project.s3AccessKeyId);
      project.s3SecretAccessKey =
        canManage && project.s3SecretAccessKey ? decrypt(project.s3SecretAccessKey) : null;
      if (project.s3Endpoint) project.s3Endpoint = decrypt(project.s3Endpoint);

      if (isDemo || !(updatable.get(project.id) ?? false)) project.apiKey = "";
      project.lwqlKey = "";
    }

    if (organization.s3AccessKeyId)
      organization.s3AccessKeyId = decrypt(organization.s3AccessKeyId);
    organization.s3SecretAccessKey =
      canManage && organization.s3SecretAccessKey ? decrypt(organization.s3SecretAccessKey) : null;
    if (organization.s3Endpoint) organization.s3Endpoint = decrypt(organization.s3Endpoint);

    // The row still carries the retired Elasticsearch columns, kept for deploy
    // safety until a migration drops them. The stored ciphertext never ships.
    organization.elasticsearchNodeUrl = null;
    organization.elasticsearchApiKey = null;
    organization.useCustomElasticsearch = false;
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
    const adminByBinding = bindings.some(
      (binding) =>
        binding.organizationId === organization.id &&
        binding.scopeType === "ORGANIZATION" &&
        binding.role === "ADMIN",
    );
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

    const isExternal =
      !adminByBinding &&
      organization.members[0]?.role !== "ADMIN" &&
      organization.members[0]?.role !== "MEMBER";

    organization.teams = organization.teams.filter((team) => {
      team.members = team.members.filter(
        (member) => member.userId === userId || member.userId === demoProjectUserId,
      );
      team.members = OrganizationMembershipService.enrichTeamWithRoleBindings(
        team,
        userId,
        [...bindings],
        organization.id,
      ).members;

      if (isDemoOrganization) return true;
      return isExternal ? team.members.some((member) => member.userId === userId) : true;
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

/** Runs one asynchronous read over a list, a few at a time. */
async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  run: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(PERMISSION_PROBE_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await run(item);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
