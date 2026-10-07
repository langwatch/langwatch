import { ClickHouseRoutesRepository } from "../clickhouse.routes.repository.ts";

/** A memory process holds no ClickHouse, so no organization is privately routed. */
export class MemoryClickHouseRoutesRepository extends ClickHouseRoutesRepository {
  static create(): MemoryClickHouseRoutesRepository {
    return new MemoryClickHouseRoutesRepository();
  }

  findPrivateRoutes(): ReadonlyMap<string, string> {
    return new Map();
  }
}
