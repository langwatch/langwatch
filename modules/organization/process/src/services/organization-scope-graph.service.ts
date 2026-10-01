/**
 * The scope graph the browser resolves every page against: the caller's organizations,
 * teams and projects, narrowed to what they can open, versioned by content hash so
 * a browser holding the current version is answered `unchanged` (ADR-164).
 */
import { createHash } from "node:crypto";

import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  OrganizationApiScopeGraphInput,
  OrganizationCaller,
  ScopeGraphAnswer,
  ScopeGraphOrganization,
} from "@langwatch/organization-contract";

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

  async getScopeGraph(
    input: OrganizationApiScopeGraphInput,
    by: OrganizationCaller,
  ): Promise<ScopeGraphAnswer> {
    const userId = by.id;
    const organizations = await this.deps.reader.findScopeGraphForUser({ userId });

    // Team- and organization-scoped bindings, direct or through a group, open
    // teams the caller holds no membership row on.
    const orgIds = organizations.map((organization) => organization.id);
    const bindings =
      orgIds.length > 0
        ? await this.deps.permissions.listBindingsForSynthesis({ orgIds, userId })
        : [];

    const graph = organizations.map((organization) =>
      narrowScopeGraphToViewer({ organization, userId, bindings }),
    );
    const version = scopeGraphVersion({ userId, graph });

    return input.since === version ? { unchanged: true } : { version, graph };
  }
}

/**
 * The hash `contentEtag` takes in packages/api/src/trpc/session-version.ts, user-prefixed so
 * no user's version matches another's. ponytail: restated, not imported (services may not
 * reach @langwatch/api/trpc); the framework `versioned` read replaces it.
 */
function scopeGraphVersion({
  userId,
  graph,
}: {
  userId: string;
  graph: readonly ScopeGraphOrganization[];
}): string {
  return `${userId}.${createHash("sha256").update(JSON.stringify(graph)).digest("base64url")}`;
}
