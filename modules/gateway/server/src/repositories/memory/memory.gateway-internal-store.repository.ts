import type {
  GatewayBudget,
  GatewayBudgetBucketBoundary,
  VirtualKeyWithScopes,
} from "@langwatch/gateway-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { GatewayInternalStore } from "../gateway-internal-store.repository.ts";

/** The rows a memory-tier install seeds the internal store with. */
export interface MemoryGatewayInternalStoreSeed {
  virtualKeys?: readonly VirtualKeyWithScopes[];
  budgets?: readonly GatewayBudget[];
  bucketBoundaries?: ReadonlyArray<
    Pick<GatewayBudgetBucketBoundary, "budgetId" | "bucketScopeId" | "periodStartedAt">
  >;
  projects?: ReadonlyArray<{ id: string; teamId: string; organizationId: string }>;
}

/**
 * The memory tier of {@link GatewayInternalStore}, for a deployment with no
 * Postgres. Seeded once at construction rather than written through, since
 * the internal family is a read surface plus one best-effort timestamp bump.
 */
export class MemoryGatewayInternalStoreRepository extends GatewayInternalStore {
  static create(seed: MemoryGatewayInternalStoreSeed = {}): MemoryGatewayInternalStoreRepository {
    return new MemoryGatewayInternalStoreRepository(seed);
  }

  #virtualKeys: VirtualKeyWithScopes[];
  #budgets: GatewayBudget[];
  #bucketBoundaries: Array<
    Pick<GatewayBudgetBucketBoundary, "budgetId" | "bucketScopeId" | "periodStartedAt">
  >;
  #projects: Array<{ id: string; teamId: string; organizationId: string }>;

  private constructor(seed: MemoryGatewayInternalStoreSeed) {
    super();
    this.#virtualKeys = [...(seed.virtualKeys ?? [])];
    this.#budgets = [...(seed.budgets ?? [])];
    this.#bucketBoundaries = [...(seed.bucketBoundaries ?? [])];
    this.#projects = [...(seed.projects ?? [])];
  }

  async tryFindVirtualKeyForConfig(virtualKeyId: string): Promise<VirtualKeyWithScopes | null> {
    return this.#virtualKeys.find((key) => key.id === virtualKeyId) ?? null;
  }

  async tryFindBudget(budgetId: string): Promise<GatewayBudget | null> {
    return this.#budgets.find((budget) => budget.id === budgetId) ?? null;
  }

  async tryFindBucketBoundary({
    budgetId,
    bucketScopeId,
  }: {
    budgetId: string;
    bucketScopeId: string;
  }): Promise<Pick<GatewayBudgetBucketBoundary, "periodStartedAt"> | null> {
    const boundary = this.#bucketBoundaries.find(
      (row) => row.budgetId === budgetId && row.bucketScopeId === bucketScopeId,
    );
    return boundary ? { periodStartedAt: boundary.periodStartedAt } : null;
  }

  async listProjectIdsForOrganization(organizationId: string): Promise<string[]> {
    return this.#projects
      .filter((project) => project.organizationId === organizationId)
      .map((project) => project.id);
  }

  async findVirtualKeysForAttribution(virtualKeyIds: readonly string[]): Promise<
    Array<{
      id: string;
      organizationId: string;
      principalUserId: string | null;
      lastUsedAt: Instant | null;
    }>
  > {
    return this.#virtualKeys
      .filter((key) => virtualKeyIds.includes(key.id))
      .map((key) => ({
        id: key.id,
        organizationId: key.organizationId,
        principalUserId: key.principalUserId ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
      }));
  }

  async findProjectTeams(
    projectIds: readonly string[],
  ): Promise<Array<{ id: string; teamId: string }>> {
    return this.#projects
      .filter((project) => projectIds.includes(project.id))
      .map((project) => ({ id: project.id, teamId: project.teamId }));
  }

  async touchVirtualKeysLastUsed(input: {
    virtualKeyIds: readonly string[];
    now: Instant;
  }): Promise<void> {
    const now = input.now ?? nowInstant();
    this.#virtualKeys = this.#virtualKeys.map((key) =>
      input.virtualKeyIds.includes(key.id) ? { ...key, lastUsedAt: now } : key,
    );
  }
}
