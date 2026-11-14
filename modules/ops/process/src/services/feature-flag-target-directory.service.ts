import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  FEATURE_FLAG_TARGET_SEARCH_LIMIT,
  type OpsFeatureFlagTarget,
  type OpsFindFeatureFlagTargetsInput,
  type OpsSearchFeatureFlagTargetsInput,
} from "@langwatch/ops-contract";
import type {
  OrganizationApi,
  OrganizationOperatorSummary,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi, UserProfile } from "@langwatch/user-contract";

type OrganizationTarget = Extract<OpsFeatureFlagTarget, { kind: "organization" }>;
type ProjectTarget = Extract<OpsFeatureFlagTarget, { kind: "project" }>;
type UserTarget = Extract<OpsFeatureFlagTarget, { kind: "user" }>;
type OrganizationRef = { id: string; name: string; slug: string };

type FeatureFlagTargetDirectoryPeers = Readonly<{
  organizations: Pick<
    OrganizationApi,
    "searchForOperators" | "findForOperators" | "organizationIdsForMember"
  >;
  projects: Pick<ProjectApi, "searchByQuery" | "listNamesByIds">;
  users: Pick<UserApi, "searchForOperators" | "getProfiles">;
  plans: Pick<EntitlementApi, "getActivePlan">;
}>;

/**
 * The organizations, projects and users a feature flag rule may target, each with what tells it
 * apart from another of the same name. Every fact comes from its owner's Api.
 * @see modules/ops/specs/feature-flag-target-search.feature
 */
export class FeatureFlagTargetDirectoryService {
  static create(peers: FeatureFlagTargetDirectoryPeers): FeatureFlagTargetDirectoryService {
    return new FeatureFlagTargetDirectoryService(peers);
  }

  private constructor(private readonly peers: FeatureFlagTargetDirectoryPeers) {}

  async search({ kind, query }: OpsSearchFeatureFlagTargetsInput): Promise<OpsFeatureFlagTarget[]> {
    const limit = FEATURE_FLAG_TARGET_SEARCH_LIMIT;
    if (kind === "organization") {
      return this.#organizationTargets(
        await this.peers.organizations.searchForOperators({ query, limit }),
      );
    }
    if (kind === "project") {
      const found = await this.peers.projects.searchByQuery({ query, limit });
      return this.#projectTargets(found.map(({ id }) => id));
    }
    return this.#userTargets(await this.peers.users.searchForOperators({ query, limit }));
  }

  async find(input: OpsFindFeatureFlagTargetsInput): Promise<OpsFeatureFlagTarget[]> {
    const [organizations, projects, users] = await Promise.all([
      input.organizationIds.length === 0
        ? []
        : this.peers.organizations
            .findForOperators({ organizationIds: unique(input.organizationIds) })
            .then((summaries) => this.#organizationTargets(summaries)),
      this.#projectTargets(unique(input.projectIds)),
      input.userIds.length === 0
        ? []
        : this.peers.users
            .getProfiles({ userIds: unique(input.userIds) })
            .then((profiles) => this.#userTargets(profiles)),
    ]);
    return [...organizations, ...projects, ...users];
  }

  #organizationTargets(summaries: OrganizationOperatorSummary[]): Promise<OrganizationTarget[]> {
    return Promise.all(
      summaries.map(async (summary) => ({
        kind: "organization" as const,
        id: summary.id,
        name: summary.name,
        slug: summary.slug,
        createdAtMs: summary.createdAt.epochMilliseconds,
        memberCount: summary.memberCount,
        planName: await this.#planName(summary.id),
        administratorEmails: summary.administratorEmails,
      })),
    );
  }

  /** A plan that cannot be read leaves the target without a plan name; the search still answers. */
  async #planName(organizationId: string): Promise<string | null> {
    try {
      return (await this.peers.plans.getActivePlan({ organizationId })).name;
    } catch {
      return null;
    }
  }

  async #projectTargets(projectIds: string[]): Promise<ProjectTarget[]> {
    if (projectIds.length === 0) return [];
    const projects = await this.peers.projects.listNamesByIds({ projectIds });
    const organizations = await this.#organizationRefs(
      projects.map(({ organizationId }) => organizationId),
    );
    return projects.map((project) => ({
      kind: "project" as const,
      id: project.id,
      name: project.name,
      slug: project.slug,
      organization: organizations.get(project.organizationId) ?? null,
    }));
  }

  async #userTargets(profiles: readonly UserProfile[]): Promise<UserTarget[]> {
    const memberships = await Promise.all(
      profiles.map((profile) =>
        this.peers.organizations.organizationIdsForMember({ userId: profile.id }),
      ),
    );
    const organizations = await this.#organizationRefs(memberships.flat());
    return profiles.map((profile, index) => ({
      kind: "user" as const,
      id: profile.id,
      name: profile.name,
      email: profile.email,
      organizations: (memberships[index] ?? []).flatMap((id) => organizations.get(id) ?? []),
    }));
  }

  async #organizationRefs(organizationIds: string[]): Promise<Map<string, OrganizationRef>> {
    if (organizationIds.length === 0) return new Map();
    const summaries = await this.peers.organizations.findForOperators({
      organizationIds: unique(organizationIds),
    });
    return new Map(summaries.map(({ id, name, slug }) => [id, { id, name, slug }]));
  }
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
