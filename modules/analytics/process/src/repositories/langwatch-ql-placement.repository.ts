/** Where a tenant's ClickHouse rows live, as the stores' router decided it (ADR-200). */
export type LangWatchQLPlacement = Readonly<{
  /** The organisation is recorded as keeping its data on its own server. */
  recordedPrivate: boolean;
  /** The router resolved one of its private routes, rather than the shared server. */
  routedPrivately: boolean;
  /** The credential-free origin of the server its rows resolve to; null where there is none. */
  origin: string | null;
}>;

/**
 * The route the stores chose for a tenant, read without running a statement (ADR-200). An
 * unknown tenant throws: an unreadable route is never answered as the shared server.
 */
export abstract class LangWatchQLPlacementRepository {
  abstract placementOf(input: { tenantId: string }): Promise<LangWatchQLPlacement>;
}
