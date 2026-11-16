import { AuthorizedClickHouse, type ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";

import type { TraceClickHouseClient } from "../../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { LegacyTraceMappingService } from "../../../../services/legacy-trace-mapping.service.ts";
import {
  TraceLegacyReadClickHouseRepository,
  type ClickHouseTraceLegacyReadOptions,
} from "../../trace-legacy-read.repository.ts";

type MappingInputs = Omit<Parameters<typeof LegacyTraceMappingService.create>[0], "repository">;

/** The store a test composes: a scripted member client stands in for both readers. */
export type LegacyStoreInputs = ClickHouseTraceLegacyReadOptions & {
  resolveClickHouseClient?: (tenantId: string) => Promise<TraceClickHouseClient>;
};

/** The ClickHouse store over a scripted member client, as the registry composes it. */
export function legacyStoreOver({
  resolveClickHouseClient,
  ...store
}: LegacyStoreInputs): TraceLegacyReadClickHouseRepository {
  const clickhouse =
    store.clickhouse ?? (resolveClickHouseClient ? fencedOver(resolveClickHouseClient) : undefined);
  const reader =
    store.reader ?? (resolveClickHouseClient ? builtOver(resolveClickHouseClient) : undefined);
  return TraceLegacyReadClickHouseRepository.create({ ...store, clickhouse, reader });
}

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

/**
 * The built-read client over the same member client, routed to the statement's tenant setting,
 * so the built reads reach the test's `query` double as the fenced reads do.
 */
export function builtOver(
  resolveClickHouseClient: (tenantId: string) => Promise<TraceClickHouseClient>,
): Pick<ClickHouseQueryClient, "read"> {
  return clickHouseQueryClientDouble({
    read: async ({ statement }) => {
      const settings: Record<string, unknown> = statement.settings ?? {};
      const tenant = settings.SQL_langwatch_tenant_ids;
      const member = await resolveClickHouseClient(typeof tenant === "string" ? tenant : "");
      const result = await member.query({
        query: statement.sql,
        query_params: statement.params,
        format: "JSONEachRow",
      });
      return { rows: await result.json() };
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
}: MappingInputs & LegacyStoreInputs): LegacyTraceMappingService {
  return LegacyTraceMappingService.create({
    repository: legacyStoreOver(store),
    traceCanonicalisation,
    resolveTraceSpans,
    resolveTraceSpansBatch,
    retentionDays,
  });
}
