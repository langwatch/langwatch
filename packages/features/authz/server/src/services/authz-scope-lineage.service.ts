import {
  BINDING_SCOPE_TIERS,
  type AuthzScopeLineageEntry,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  SCOPE_TIER_FIELDS,
  type BindingScopeTier,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { ScopeLineageRepository } from "../repositories/authz-read.repository";

type PresentScope = Readonly<{ tier: BindingScopeTier; id: string }>;

const logger = createLogger("langwatch:authz:scope-lineage");

/** Resolves every scope id in one request and enforces one tenant lineage. */
export class AuthzScopeLineageService {
  private constructor(private readonly repository: ScopeLineageRepository) {}

  static create(options: { repository: ScopeLineageRepository }): AuthzScopeLineageService {
    return new AuthzScopeLineageService(options.repository);
  }

  async check(input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult> {
    const scopes = presentScopes(input);
    if (scopes.length < 2) {
      return { kind: "consistent" };
    }

    const entries = await Promise.all(scopes.map((scope) => this.resolve(scope)));
    const organizations = new Set(entries.map((entry) => entry.organizationId));
    if (organizations.size === 1 && !organizations.has(null)) {
      return { kind: "consistent" };
    }

    logger.warn(
      { scopes: entries },
      "refused: one request carries scope ids that do not resolve to one organization",
    );

    return { kind: "mismatch", widest: widestScope(scopes), entries };
  }

  private async resolve(scope: PresentScope): Promise<AuthzScopeLineageEntry> {
    switch (scope.tier) {
      case "organization":
        return { ...scope, organizationId: scope.id };
      case "team": {
        const team = await this.repository.tryFindTeamOrganization({ teamId: scope.id });
        return { ...scope, organizationId: team?.organizationId ?? null };
      }
      case "project": {
        const project = await this.repository.tryFindProjectLineage({ projectId: scope.id });
        return { ...scope, organizationId: project?.organizationId ?? null };
      }
    }
  }
}

function presentScopes(input: AuthzScopeLineageInput): PresentScope[] {
  return BINDING_SCOPE_TIERS.flatMap((tier) => {
    const id = input[SCOPE_TIER_FIELDS[tier]];
    return typeof id === "string" && id.length > 0 ? [{ tier, id }] : [];
  });
}

function widestScope(scopes: readonly PresentScope[]): PresentScope {
  return [...scopes].sort(
    (left, right) =>
      BINDING_SCOPE_TIERS.indexOf(right.tier) - BINDING_SCOPE_TIERS.indexOf(left.tier),
  )[0]!;
}
