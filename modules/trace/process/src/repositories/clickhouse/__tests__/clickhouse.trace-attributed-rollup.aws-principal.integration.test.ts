// A principal ARN goes through the ingest redaction (essential PII) and is still found by value.
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { redactAttributeNative, type RedactionPolicy } from "@langwatch/redaction/pii";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceAttributedRollupRepository } from "../clickhouse.trace-attributed-rollup.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const KEY = "aws.principal.arn";
const ARN = "arn:aws:iam::123456789012:role/traced-agent";
const SESSION_B = "arn:aws:sts::123456789012:assumed-role/traced-agent/sessionB";
const OTHER_ROLE_SESSION = "arn:aws:sts::123456789012:assumed-role/traced-agent-2/sessionA";
const SESSIONS_PREFIX = "arn:aws:sts::123456789012:assumed-role/traced-agent/";
const tenantId = `test-awsarn-${nanoid()}`;
const ESSENTIAL: RedactionPolicy = {
  pii: { level: "essential", entities: [], exceptPatterns: [] },
  secrets: { enabled: true, customPatterns: [] },
};

let ch: ClickHouseClient;
let repository: ClickHouseTraceAttributedRollupRepository;
let stored = "";

function queryClient(raw: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await raw.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("the attributed rollups never insert")),
    command: () => Promise.reject(new Error("the attributed rollups never command")),
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

beforeAll(async () => {
  if (!testClickHouseConfigured()) return;
  ch = await startMigratedTraceClickHouse();
  repository = ClickHouseTraceAttributedRollupRepository.create(queryClient(ch));
  stored = redactAttributeNative({ key: KEY, value: ARN, policy: ESSENTIAL }).text;
  const at = new Date(Date.now() - 60_000);
  const traces: [string, string][] = [
    ["t-arn", stored],
    ["t-session-b", SESSION_B],
    ["t-other-role", OTHER_ROLE_SESSION],
  ];
  await ch.insert({
    table: "trace_summaries",
    format: "JSONEachRow",
    clickhouse_settings: { date_time_input_format: "best_effort" },
    values: traces.map(([traceId, arn]) => ({
      ProjectionId: `projn-${nanoid()}`,
      TenantId: tenantId,
      TraceId: traceId,
      Version: "v1",
      Attributes: { [KEY]: arn },
      OccurredAt: at,
      CreatedAt: at,
      UpdatedAt: at,
      ComputedIOSchemaVersion: "",
      TotalDurationMs: 250,
      SpanCount: 1,
      ContainsErrorStatus: false,
      ContainsOKStatus: true,
      Models: ["anthropic.claude-v5"],
      TokensEstimated: false,
      OutputFromRootSpan: false,
      OutputSpanEndTimeMs: 0,
      BlockedByGuardrail: false,
      TraceName: traceId,
      RootSpanType: "",
      ContainsAi: true,
      ContainsPrompt: false,
      AnnotationIds: [],
      LastEventOccurredAt: at,
    })),
  });
});

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query: "DELETE FROM trace_summaries WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
  });
});

describe.skipIf(!testClickHouseConfigured())("a traced agent's AWS principal ARN", () => {
  it("keeps the ARN through essential PII redaction", () => {
    expect(stored).toBe(ARN);
  });

  it("is counted when asked by the exact ARN", async () => {
    await expect(
      repository.countAttributedTracesByValue({
        tenantId,
        matches: [],
        valueKey: KEY,
        values: [ARN],
        sinceMs: Date.now() - 24 * 60 * 60 * 1000,
      }),
    ).resolves.toEqual([{ value: ARN, count: 1 }]);
  });

  it("counts the IAM form and another session of the role, not a role sharing its prefix", async () => {
    const rows = await repository.countAttributedTracesByValue({
      tenantId,
      matches: [],
      valueKey: KEY,
      values: [ARN],
      valuePrefixes: [SESSIONS_PREFIX],
      sinceMs: Date.now() - 24 * 60 * 60 * 1000,
    });
    expect(rows.toSorted((a, b) => a.value.localeCompare(b.value))).toEqual([
      { value: ARN, count: 1 },
      { value: SESSION_B, count: 1 },
    ]);
  });
});
