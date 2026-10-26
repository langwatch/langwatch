import type { ReadBudgetLimits } from "@langwatch/api";
import type { AuthzDeclaredScopeId } from "@langwatch/authorization";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { type RequestBoundKey, resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

/**
 * Off: a read past its allowance is logged and answered. On: it is refused
 * (read-rate-limits.feature).
 */
export const READ_RATE_LIMITS_ENFORCED_FLAG = "release_read_rate_limits_enforced";

const CACHE_MS = 60_000;

/** Scopes held at once; past it the longest-held goes first, so the cache stays bounded. */
export const MAX_CACHED_SCOPES = 10_000;

export type ApiDoorReadBudgetPeers = Readonly<{
  projects: Pick<ProjectApi, "getOrganizationId">;
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  entitlements: Pick<EntitlementApi, "requestBound">;
}>;

type Resolved = Readonly<{ limits: ReadBudgetLimits; organizationId: string | null }>;

/** The allowances and the enforcement switch the read budget asks, cached a minute per scope. */
export class ApiDoorReadBudgetService {
  static create(peers: ApiDoorReadBudgetPeers): ApiDoorReadBudgetService {
    return new ApiDoorReadBudgetService(peers);
  }

  readonly #peers: ApiDoorReadBudgetPeers;
  readonly #limits = new Map<string, Readonly<{ at: number; value: Promise<Resolved> }>>();

  private constructor(peers: ApiDoorReadBudgetPeers) {
    this.#peers = peers;
  }

  limitsFor({ scope }: { scope: AuthzDeclaredScopeId | null }): Promise<Resolved> {
    const key = scope ? `${scope.tier}:${scope.id}` : "none";
    const cached = this.#limits.get(key);
    if (cached && nowInstant().epochMilliseconds - cached.at < CACHE_MS) return cached.value;

    const value = this.#resolve(scope);
    value.catch(() => {
      if (this.#limits.get(key)?.value === value) this.#limits.delete(key);
    });
    this.#remember(key, { at: nowInstant().epochMilliseconds, value });
    return value;
  }

  /** Re-inserted at the end, so the first key is always the one held longest. */
  #remember(key: string, entry: Readonly<{ at: number; value: Promise<Resolved> }>): void {
    this.#limits.delete(key);
    this.#limits.set(key, entry);
    if (this.#limits.size <= MAX_CACHED_SCOPES) return;

    const oldest = this.#limits.keys().next();
    if (!oldest.done) this.#limits.delete(oldest.value);
  }

  async enforced({ scope }: { scope: AuthzDeclaredScopeId | null }): Promise<boolean> {
    const { organizationId } = await this.limitsFor({ scope });
    return this.#peers.featureFlags.isEnabled(
      READ_RATE_LIMITS_ENFORCED_FLAG,
      organizationId ? { kind: "organization", organizationId } : { kind: "system" },
    );
  }

  async #resolve(scope: AuthzDeclaredScopeId | null): Promise<Resolved> {
    const organizationId = await this.#organizationOf(scope);
    if (!organizationId) return { limits: await this.#bounds(null), organizationId: null };
    return { limits: await this.#bounds(organizationId), organizationId };
  }

  async #organizationOf(scope: AuthzDeclaredScopeId | null): Promise<string | null> {
    if (scope?.tier === "organization") return scope.id;
    if (scope?.tier === "project") return this.#peers.projects.getOrganizationId(scope.id);
    return null;
  }

  async #bounds(organizationId: string | null): Promise<ReadBudgetLimits> {
    // A call naming no tenant answers the paid tier's allowance: there is no plan to ask.
    const bound = (key: RequestBoundKey) =>
      organizationId
        ? this.#peers.entitlements.requestBound({ key, organizationId })
        : Promise.resolve(resolveRequestBound(key, "PRO"));
    const [
      readsPerMinute,
      rowsPerHour,
      rowsPerDay,
      exportsPerMinute,
      exportsPerDay,
      impersonationReadsPerMinute,
      impersonationRowsPerDay,
    ] = await Promise.all([
      bound("readRequestsPerMinute"),
      bound("readRowsPerHour"),
      bound("readRowsPerDay"),
      bound("readExportsPerMinute"),
      bound("readExportsPerDay"),
      bound("impersonationReadsPerMinute"),
      bound("impersonationRowsPerDay"),
    ]);
    return {
      readsPerMinute,
      rowsPerHour,
      rowsPerDay,
      exportsPerMinute,
      exportsPerDay,
      impersonationReadsPerMinute,
      impersonationRowsPerDay,
    };
  }
}
