import {
  type LangWatchQLPlacement,
  LangWatchQLPlacementRepository,
} from "../langwatch-ql-placement.repository.ts";

/** The one server of the memory tier, as an origin a gate can compare with. */
export const MEMORY_SHARED_ORIGIN = "http://clickhouse.memory.invalid:8123";

/** The memory tier has one server: every tenant is on it unless a suite names it otherwise. */
export class MemoryLangWatchQLPlacementRepository extends LangWatchQLPlacementRepository {
  private constructor(
    private readonly routed: ReadonlySet<string>,
    private readonly recordedPrivate: ReadonlySet<string>,
    private readonly sharedOrigin: string,
  ) {
    super();
  }

  /**
   * `routedTenants` resolve to their own server; `recordedPrivateTenants` were recorded so; every
   * other tenant is on `sharedOrigin`.
   */
  static create({
    routedTenants = [],
    recordedPrivateTenants = [],
    sharedOrigin = MEMORY_SHARED_ORIGIN,
  }: {
    routedTenants?: readonly string[];
    recordedPrivateTenants?: readonly string[];
    sharedOrigin?: string;
  } = {}): MemoryLangWatchQLPlacementRepository {
    return new MemoryLangWatchQLPlacementRepository(
      new Set(routedTenants),
      new Set([...routedTenants, ...recordedPrivateTenants]),
      sharedOrigin,
    );
  }

  placementOf({ tenantId }: { tenantId: string }): Promise<LangWatchQLPlacement> {
    const routedPrivately = this.routed.has(tenantId);
    return Promise.resolve({
      recordedPrivate: this.recordedPrivate.has(tenantId),
      routedPrivately,
      origin: routedPrivately ? `http://${tenantId}.memory.invalid:8123` : this.sharedOrigin,
    });
  }
}
