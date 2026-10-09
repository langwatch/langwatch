/** The ClickHouse store's private routes (§7), organization id to URL, read when a pass asks. */
export abstract class ClickHouseRoutesRepository {
  abstract findPrivateRoutes(): ReadonlyMap<string, string>;
}
