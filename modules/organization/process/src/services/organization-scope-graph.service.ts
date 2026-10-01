/**
 * The scope graph the browser resolves every page against: the caller's organizations,
 * teams and projects, narrowed to what they can open.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationCaller, ScopeGraphOrganization } from "@langwatch/organization-contract";

import { narrowScopeGraphToViewer } from "../rules/scope-graph-visibility.rules.ts";

/** The one narrow read the graph is built from; members hold only the caller's rows. */
export interface OrganizationScopeGraphReader {
  findScopeGraphForUser(input: Readonly<{ userId: string }>): Promise<ScopeGraphOrganization[]>;
}

export interface OrganizationScopeGraphDependencies {
  readonly reader: OrganizationScopeGraphReader;
  readonly permissions: Pick<AuthzApi, "listBindingsForSynthesis">;
}

export class OrganizationScopeGraphService {
  static create(dependencies: OrganizationScopeGraphDependencies): OrganizationScopeGraphService {
    return new OrganizationScopeGraphService(dependencies);
  }

  private constructor(private readonly deps: OrganizationScopeGraphDependencies) {}

  async getScopeGraph(by: OrganizationCaller): Promise<ScopeGraphOrganization[]> {
    const userId = by.id;
    const organizations = await this.deps.reader.findScopeGraphForUser({ userId });

    // Team- and organization-scoped bindings, direct or through a group, open
    // teams the caller holds no membership row on.
    const orgIds = organizations.map((organization) => organization.id);
    const bindings =
      orgIds.length > 0
        ? await this.deps.permissions.listBindingsForSynthesis({ orgIds, userId })
        : [];

    return organizations.map((organization) =>
      narrowScopeGraphToViewer({ organization, userId, bindings }),
    );
  }
}
