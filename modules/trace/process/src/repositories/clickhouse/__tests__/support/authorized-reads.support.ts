/**
 * ADR-175 test seams: the proof-checking reader over a real ClickHouse, behind the same tenant
 * guard production runs, and a recording one for unit tests that assert on what was sent.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  ClickHouseQueryClient,
  TenantGuard,
  type QueryRequest,
  type QueryResult,
} from "@langwatch/clickhouse-client";

import { AuthorizedTraceReadsRepository } from "../../clickhouse.trace-member-client.repository.ts";

/** The reader over one test server, every statement passing the production tenant guard. */
export function authorizedReadsOver(ch: ClickHouseClient): AuthorizedTraceReadsRepository {
  const clickhouse = new ClickHouseQueryClient({
    driver: {
      execute: async <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
        const result = await ch.query({
          query: request.sql,
          query_params: request.params ?? {},
          format: "JSONEachRow",
          ...(request.settings ? { clickhouse_settings: request.settings } : {}),
        });
        return { rows: await result.json<Row>() };
      },
      insert: () => Promise.reject(new Error("the read seam does not write")),
      command: () => Promise.reject(new Error("the read seam does not run commands")),
    },
    tenantGuard: new TenantGuard(),
  });
  return AuthorizedTraceReadsRepository.create({ clickhouse });
}

/** A reader that records each expanded statement it is sent and answers `rows` in turn. */
export function recordingAuthorizedReads(answers: readonly unknown[][] = []): {
  reads: AuthorizedTraceReadsRepository;
  sent: QueryRequest[];
} {
  const sent: QueryRequest[] = [];
  const reads = AuthorizedTraceReadsRepository.create({
    clickhouse: {
      query: <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
        const answer = answers[sent.length] ?? answers.at(-1) ?? [];
        sent.push(request);
        return Promise.resolve({ rows: answer as Row[] });
      },
    },
  });
  return { reads, sent };
}
