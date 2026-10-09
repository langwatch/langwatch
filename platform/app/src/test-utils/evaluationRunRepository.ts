/**
 * The evaluation run repository over one ClickHouse client, for a test that
 * writes and reads evaluations against a real or recording client. The
 * summaries read goes through the authorized client the way production wires
 * it (ADR-144 block C), so a test seals its proof with `ownProof`.
 */
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { EvaluationRunClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";

export function evaluationRunRepositoryFor({
  resolveClient,
  retentionResolver,
}: {
  resolveClient: ClickHouseClientResolver;
  retentionResolver?: RetentionPolicyResolver;
}): EvaluationRunClickHouseRepository {
  return new EvaluationRunClickHouseRepository({
    resolveClient,
    clickhouse: new AuthorizedClickHouse({ resolveClient }),
    ...(retentionResolver !== undefined ? { retentionResolver } : {}),
  });
}
