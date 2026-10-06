/**
 * The span storage repository over one ClickHouse client, for a test that
 * writes and reads spans against a real or recording client. Reads go through
 * the authorized client the way production wires them (ADR-144 block C), so a
 * test seals its proof with `ownProof` and never names a tenant on a read.
 */
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

export function spanStorageRepositoryFor(
  resolveClient: ClickHouseClientResolver,
): SpanStorageClickHouseRepository {
  return new SpanStorageClickHouseRepository({
    resolveClient,
    clickhouse: new AuthorizedClickHouse({ resolveClient }),
  });
}
