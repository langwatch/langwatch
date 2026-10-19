// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  MePersonalCredential,
  MeUsage,
  PersonalUsageQueryInput,
  PersonalUsageRollup,
} from "@langwatch/enterprise-governance-contract";
import {
  OrganizationNotFoundForTeamError,
  type OrganizationApi,
} from "@langwatch/organization-contract";
import { PROJECT_KIND, type ProjectApi, type ProjectIdentity } from "@langwatch/project-contract";
import {
  PersonalProjectKeyRequiredError,
  PersonalUsageServiceKeyUnsupportedError,
  type UserApi,
} from "@langwatch/user-contract";

/** Whose key, on which project, over which window. Absent window means the store's default. */
type PersonalUsageKeyQuery = {
  projectId: string;
  credential: MePersonalCredential;
  window?: { startMs: number; endMs: number };
};

type PersonalUsageKeyServiceOptions = {
  projects: Pick<ProjectApi, "findIdentity" | "findInternal">;
  organizations: Pick<OrganizationApi, "getOrganizationIdByTeamId">;
  /** Whether the asking member is the personal workspace's owner. */
  users: Pick<UserApi, "personalCallerFor">;
  rollups: { rollup(input: PersonalUsageQueryInput): Promise<PersonalUsageRollup> };
};

/** `/api/me/usage`: the personal rollup one API key may read. */
export class PersonalUsageKeyService {
  static create(options: PersonalUsageKeyServiceOptions): PersonalUsageKeyService {
    return new PersonalUsageKeyService(options);
  }

  private constructor(private readonly options: PersonalUsageKeyServiceOptions) {}

  /**
   * Scoped to THIS organization's hidden governance tenant, not the personal project,
   * both to prune partitions and to stop a person in several organizations from summing
   * usage across them.
   */
  async read({ projectId, credential, window }: PersonalUsageKeyQuery): Promise<MeUsage> {
    const project = await this.#requireProject({ projectId });
    const ownerUserId = this.#callerFor({ project, credential });
    const organizationId =
      (credential.kind === "legacyProjectKey" ? null : credential.organizationId) ??
      (await this.#findOrganizationIdByTeamId({ teamId: project.teamId }));
    const tenant = organizationId
      ? await this.options.projects.findInternal({
          organizationId,
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        })
      : null;

    return this.options.rollups.rollup({
      personalProjectId: project.id,
      userId: ownerUserId,
      ...(tenant ? { ingestionTenantId: tenant.id } : {}),
      ...(window ? { window } : {}),
    });
  }

  /**
   * The key's class is half the decision: a service key belongs to nobody and must
   * not be read as this workspace's own legacy key.
   */
  #callerFor(input: {
    project: { isPersonal: boolean; ownerUserId: string | null };
    credential: MePersonalCredential;
  }): string {
    if (!input.project.isPersonal || !input.project.ownerUserId) {
      throw new PersonalProjectKeyRequiredError();
    }

    if (input.credential.kind === "legacyProjectKey") return input.project.ownerUserId;
    if (input.credential.userId === null) throw new PersonalUsageServiceKeyUnsupportedError();

    return this.options.users.personalCallerFor({
      project: input.project,
      callerUserId: input.credential.userId,
    });
  }

  #findOrganizationIdByTeamId(input: { teamId: string }): Promise<string | null> {
    return this.options.organizations.getOrganizationIdByTeamId(input).catch((error: unknown) => {
      if (OrganizationNotFoundForTeamError.is(error)) return null;
      throw error;
    });
  }

  async #requireProject({ projectId }: { projectId: string }): Promise<ProjectIdentity> {
    const project = await this.options.projects.findIdentity(projectId);

    if (!project) throw new Error(`no project row for the credential's project "${projectId}"`);

    return project;
  }
}
