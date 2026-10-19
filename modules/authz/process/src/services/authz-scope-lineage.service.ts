import {
  DECLARED_SCOPE_TIERS,
  type AuthzScopeLineageEntry,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  SCOPE_TIER_FIELDS,
  type DeclaredScopeTier,
} from "@langwatch/authorization";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { AuthzLineageEpochRepository } from "../repositories/authz-lineage-epoch.repository.ts";
import type { ScopeLineageRepository } from "../repositories/authz-read.repository.ts";

type PresentScope = Readonly<{ tier: DeclaredScopeTier; id: string }>;

type ProjectLineage = { teamId: string; organizationId: string };
type TeamOrganization = { organizationId: string };
type HeldLineage<T> = { value: T; storedAtMs: number; epoch: number };

/** A backstop: the organization's lineage signal is what drops a held lineage after a move. */
export const LINEAGE_CACHE_MAX_AGE_MS = 60_000;
const MAX_LINEAGE_ENTRIES = 10_000;

/** Resolves every scope id in one request and enforces one tenant lineage. */
export class AuthzScopeLineageService {
  private readonly projects = new Map<string, HeldLineage<ProjectLineage>>();
  private readonly teams = new Map<string, HeldLineage<TeamOrganization>>();

  private readonly repository: ScopeLineageRepository;
  private readonly logger: Logger;
  private readonly cacheEnabled: () => boolean;
  private readonly signal: AuthzLineageEpochRepository | undefined;

  private constructor(options: {
    repository: ScopeLineageRepository;
    logger: Logger;
    cacheEnabled: () => boolean;
    signal: AuthzLineageEpochRepository | undefined;
  }) {
    this.repository = options.repository;
    this.logger = options.logger;
    this.cacheEnabled = options.cacheEnabled;
    this.signal = options.signal;
  }

  static create(options: {
    repository: ScopeLineageRepository;
    logger?: Logger;
    /** The grants cache's kill switch; omitted = every lineage is read afresh. */
    cacheEnabled?: () => boolean;
    /** The organization's lineage signal; omitted = nothing is held. */
    signal?: AuthzLineageEpochRepository;
  }): AuthzScopeLineageService {
    return new AuthzScopeLineageService({
      repository: options.repository,
      logger: options.logger ?? createLogger("langwatch:authz:scope-lineage"),
      cacheEnabled: options.cacheEnabled ?? (() => false),
      signal: options.signal,
    });
  }

  /** A project of this organization moved or was archived; throws so the delivery is retried. */
  async lineageChanged({ organizationId }: { organizationId: string }): Promise<void> {
    await this.signal?.bump({ organizationId });
    forgetOrganization(this.projects, organizationId);
    forgetOrganization(this.teams, organizationId);
  }

  /** A project's team and organization, held up to a minute; unknown or archived is never held. */
  findProjectLineage: ScopeLineageRepository["findProjectLineage"] = ({ projectId }) =>
    this.held({
      entries: this.projects,
      id: projectId,
      read: () => this.repository.findProjectLineage({ projectId }),
    });

  /** A team's organization, held up to a minute; an unknown team is never held. */
  findTeamOrganization: ScopeLineageRepository["findTeamOrganization"] = ({ teamId }) =>
    this.held({
      entries: this.teams,
      id: teamId,
      read: () => this.repository.findTeamOrganization({ teamId }),
    });

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

    this.logger.warn(
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
        const team = await this.findTeamOrganization({ teamId: scope.id });

        return { ...scope, organizationId: team?.organizationId ?? null };
      }
      case "project": {
        const project = await this.findProjectLineage({ projectId: scope.id });

        return { ...scope, organizationId: project?.organizationId ?? null };
      }
    }
  }

  private async held<T extends { organizationId: string }>({
    entries,
    id,
    read,
  }: {
    entries: Map<string, HeldLineage<T>>;
    id: string;
    read: () => Promise<T | null>;
  }): Promise<T | null> {
    const signal = this.signal;
    if (!signal || !this.cacheEnabled()) return read();

    const nowMs = nowInstant().epochMilliseconds;
    const entry = entries.get(id);
    if (entry) {
      entries.delete(id);
      if (nowMs - entry.storedAtMs < LINEAGE_CACHE_MAX_AGE_MS) {
        const epoch = await signal.findEpoch({ organizationId: entry.value.organizationId });
        if (epoch !== null && epoch === entry.epoch) {
          entries.set(id, entry);
          return entry.value;
        }
      }
    }

    const value = await read();
    if (value === null) return null;
    const epoch = await signal.findEpoch({ organizationId: value.organizationId });
    if (epoch === null) return value;
    if (entries.size >= MAX_LINEAGE_ENTRIES) {
      const leastRecent = entries.keys().next().value;
      if (leastRecent !== void 0) entries.delete(leastRecent);
    }
    entries.set(id, { value, storedAtMs: nowMs, epoch });

    return value;
  }
}

function presentScopes(input: AuthzScopeLineageInput): PresentScope[] {
  return DECLARED_SCOPE_TIERS.flatMap((tier) => {
    const id = input[SCOPE_TIER_FIELDS[tier]];

    return typeof id === "string" && id.length > 0 ? [{ tier, id }] : [];
  });
}

function widestScope(scopes: readonly PresentScope[]): PresentScope {
  return [...scopes].toSorted(
    (left, right) =>
      DECLARED_SCOPE_TIERS.indexOf(right.tier) - DECLARED_SCOPE_TIERS.indexOf(left.tier),
  )[0]!;
}

function forgetOrganization<T extends { organizationId: string }>(
  entries: Map<string, HeldLineage<T>>,
  organizationId: string,
): void {
  for (const [id, entry] of entries) {
    if (entry.value.organizationId === organizationId) entries.delete(id);
  }
}
