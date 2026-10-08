/**
 * The trace summary repository and fold store over one ClickHouse client, for
 * a test that writes and reads summaries against a real or recording client.
 * Reads go through the authorized client the way production wires them
 * (ADR-144 block C), so a test seals its proof with `ownProof` and never
 * names a tenant on a read; the store mints an own-only proof per read.
 */
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { TraceSummaryStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.store";
import { ownProofAuthorizer } from "./authorizationProofs";

export function traceSummaryRepositoryFor(
  resolveClient: ClickHouseClientResolver,
): TraceSummaryClickHouseRepository {
  return new TraceSummaryClickHouseRepository({
    resolveClient,
    clickhouse: new AuthorizedClickHouse({ resolveClient }),
  });
}

export function traceSummaryStoreFor(
  resolveClient: ClickHouseClientResolver,
): TraceSummaryStore {
  return new TraceSummaryStore({
    repository: traceSummaryRepositoryFor(resolveClient),
    authorize: ownProofAuthorizer,
  });
}
