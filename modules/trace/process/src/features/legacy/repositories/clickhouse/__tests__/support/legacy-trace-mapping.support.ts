import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";

import type { TraceClickHouseClient } from "../../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { LegacyTraceMappingService } from "../../../../services/legacy-trace-mapping.service.ts";
import {
  TraceLegacyReadClickHouseRepository,
  type ClickHouseTraceLegacyReadOptions,
} from "../../trace-legacy-read.repository.ts";

type MappingInputs = Omit<Parameters<typeof LegacyTraceMappingService.create>[0], "repository">;

/**
 * The proof-checked client over the same member client a test scripts, so the fenced reads
 * reach the test's `query` double with their markers expanded and the tenant they routed to.
 */
export function fencedOver(
  resolveClickHouseClient: (tenantId: string) => Promise<TraceClickHouseClient>,
): AuthorizedClickHouse {
  return new AuthorizedClickHouse({
    resolveClient: async (tenantId) => {
      const member = await resolveClickHouseClient(tenantId);
      return clickHouseQueryClientDouble({
        query: async ({ sql, params, settings }) => {
          const result = await member.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
            ...(settings ? { clickhouse_settings: settings as Record<string, string> } : {}),
          });
          return { rows: await result.json() };
        },
      });
    },
  });
}

/** The ClickHouse store with the mapping service over it, as the app composes the legacy read. */
export function mappedLegacyRead({
  traceCanonicalisation,
  resolveTraceSpans,
  resolveTraceSpansBatch,
  retentionDays,
  ...store
}: MappingInputs & ClickHouseTraceLegacyReadOptions): LegacyTraceMappingService {
  const clickhouse =
    store.clickhouse ??
    (store.resolveClickHouseClient ? fencedOver(store.resolveClickHouseClient) : undefined);
  return LegacyTraceMappingService.create({
    repository: TraceLegacyReadClickHouseRepository.create({ ...store, clickhouse }),
    traceCanonicalisation,
    resolveTraceSpans,
    resolveTraceSpansBatch,
    retentionDays,
  });
}
