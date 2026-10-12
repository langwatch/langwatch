/**
 * The trace analytics repository over one ClickHouse client, for a test that
 * writes and reads back slim rows against a real or recording client. Reads
 * go through the authorized client the way production wires them (ADR-144
 * block C), so a test seals its proof with `ownProof` and never names a
 * tenant on a read.
 */
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { TraceAnalyticsClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics.clickhouse.repository";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

export function traceAnalyticsRepositoryFor(
  resolveClient: ClickHouseClientResolver,
): TraceAnalyticsClickHouseRepository {
  return new TraceAnalyticsClickHouseRepository({
    resolveClient,
    clickhouse: new AuthorizedClickHouse({ resolveClient }),
  });
}
