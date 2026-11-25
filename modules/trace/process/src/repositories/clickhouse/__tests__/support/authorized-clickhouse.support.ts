// A raw test ClickHouse behind the proof-checked reader, with trace's id indexes declared.
import type { ClickHouseClient } from "@clickhouse/client";
import { AuthorizedClickHouse, type ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";

import { TRACE_ID_INDEXES } from "../../clickhouse.trace-id-indexes.database.ts";
import {
  MemberTraceClickHouseClientRepository,
  type TraceClickHouseWriteResolver,
} from "../../clickhouse.trace-member-client.repository.ts";

export function traceQueryClientFor(client: ClickHouseClient): ClickHouseQueryClient {
  return vendorQueryClient({ vendor: client, indexes: TRACE_ID_INDEXES });
}

export function traceResolverFor(client: ClickHouseClient): TraceClickHouseWriteResolver {
  return MemberTraceClickHouseClientRepository.resolverFor(traceQueryClientFor(client));
}

export function authorizedClickHouseFor(client: ClickHouseClient): AuthorizedClickHouse {
  const queryClient = traceQueryClientFor(client);
  return new AuthorizedClickHouse({ resolveClient: async () => queryClient });
}
