/**
 * @vitest-environment node
 *
 * The ClickHouse side of the usage report, against a real ClickHouse.
 *
 * What a database has to say for these to be true: that each window cuts on
 * the table's own time column, that a replaced ledger row counts once, that a
 * re-folded session counts once, that another tenant's rows stay out, and that
 * a rung an install never reached comes back null rather than as 1970.
 *
 * @see ../instance-usage.clickhouse.repository.ts
 * @see specs/self-hosting/connected-services/usage-report.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupTestData,
  startTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { InstanceUsageStatsClickHouseRepository } from "../instance-usage.clickhouse.repository";

const RUN = nanoid(8);
const ORGANIZATION_ID = `org-usage-${RUN}`;
const PROJECT_A = `proj-usage-a-${RUN}`;
const PROJECT_B = `proj-usage-b-${RUN}`;
/** Another install's project, which no count here may reach. */
const OTHER_PROJECT = `proj-usage-other-${RUN}`;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * DAY);
const TWENTY_DAYS_AGO = new Date(NOW.getTime() - 20 * DAY);
const FORTY_DAYS_AGO = new Date(NOW.getTime() - 40 * DAY);
const SEVEN_DAYS = new Date(NOW.getTime() - 7 * DAY);
const TWENTY_EIGHT_DAYS = new Date(NOW.getTime() - 28 * DAY);

let ch: ClickHouseClient;
let repository: InstanceUsageStatsClickHouseRepository;

const INSTALL = {
  organizationId: ORGANIZATION_ID,
  projectIds: [PROJECT_A, PROJECT_B],
};

async function insert(table: string, values: Record<string, unknown>[]) {
  await ch.insert({
    table,
    values,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

function span(tenantId: string, startTime: Date): Record<string, unknown> {
  return {
    ProjectionId: `projection-${nanoid()}`,
    TenantId: tenantId,
    TraceId: `trace-${nanoid()}`,
    SpanId: `span-${nanoid()}`,
    Sampled: 1,
    StartTime: startTime,
    EndTime: new Date(startTime.getTime() + 10),
    DurationMs: 10,
    SpanName: "s",
    SpanKind: 1,
    ServiceName: "t",
    ResourceAttributes: {},
    SpanAttributes: {},
    ScopeName: "",
  };
}

function trace(
  tenantId: string,
  traceId: string,
  occurredAt: Date,
  updatedAt: Date,
): Record<string, unknown> {
  return {
    ProjectionId: `projection-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: updatedAt,
    ComputedIOSchemaVersion: "",
    TotalDurationMs: 1,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    Models: [],
    TokensEstimated: false,
  };
}

let eventTimestamp = 1;

function spend({
  tenantId,
  requestId,
  occurredAt,
  costNanoUsd,
}: {
  tenantId: string;
  requestId: string;
  occurredAt: Date;
  costNanoUsd: number;
}): Record<string, unknown> {
  return {
    TenantId: tenantId,
    GatewayRequestId: requestId,
    OrganizationId: ORGANIZATION_ID,
    VirtualKeyId: `vk-${RUN}`,
    Model: "gpt-5-mini",
    RequestType: "chat",
    Status: "confirmed",
    CostNanoUSD: costNanoUsd,
    OccurredAt: occurredAt,
    EventTimestamp: eventTimestamp++,
  };
}

function instantEvalRun(
  tenantId: string,
  createdAt: Date,
): Record<string, unknown> {
  return {
    TenantId: tenantId,
    RunId: `run-${nanoid()}`,
    Sql: "SELECT 1",
    RowLimit: 10,
    Status: "finished",
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    WrittenAt: createdAt,
  };
}

function judgment(tenantId: string, createdAt: Date): Record<string, unknown> {
  return {
    TenantId: tenantId,
    RunId: `run-${nanoid()}`,
    TraceId: `trace-${nanoid()}`,
    QuestionId: "q1",
    Kind: "bool",
    Status: "judged",
    OccurredAt: createdAt,
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
  };
}

function session({
  tenantId,
  sessionId,
  startedAt,
  updatedAt,
}: {
  tenantId: string;
  sessionId: string;
  startedAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    TenantId: tenantId,
    SessionId: sessionId,
    SessionKeySource: "session.id",
    Version: "2026-09-21",
    StartedAt: startedAt,
    UpdatedAt: updatedAt,
    Agent: "claude_code",
    UserId: "",
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repository = new InstanceUsageStatsClickHouseRepository(async () => ch);

  await insert("stored_spans", [
    span(PROJECT_A, THREE_DAYS_AGO),
    span(PROJECT_A, THREE_DAYS_AGO),
    span(PROJECT_B, TWENTY_DAYS_AGO),
    span(PROJECT_A, FORTY_DAYS_AGO),
    span(OTHER_PROJECT, THREE_DAYS_AGO),
  ]);

  // One trace in two versions, which must count once whichever window it
  // falls in, and one old trace.
  const versionedTrace = `trace-versioned-${RUN}`;
  await insert("trace_summaries", [
    trace(PROJECT_A, versionedTrace, THREE_DAYS_AGO, THREE_DAYS_AGO),
    trace(PROJECT_A, versionedTrace, THREE_DAYS_AGO, NOW),
    trace(PROJECT_B, `trace-old-${RUN}`, FORTY_DAYS_AGO, FORTY_DAYS_AGO),
    trace(OTHER_PROJECT, `trace-other-${RUN}`, THREE_DAYS_AGO, NOW),
  ]);

  // One request admitted at one price and settled at another: the ledger
  // keeps the later row, so the request counts once at its settled cost.
  const settledRequest = `req-settled-${RUN}`;
  await insert("gateway_spend", [
    spend({
      tenantId: PROJECT_A,
      requestId: settledRequest,
      occurredAt: THREE_DAYS_AGO,
      costNanoUsd: 9_000_000_000,
    }),
    spend({
      tenantId: PROJECT_A,
      requestId: settledRequest,
      occurredAt: THREE_DAYS_AGO,
      costNanoUsd: 2_500_000_000,
    }),
    spend({
      tenantId: PROJECT_B,
      requestId: `req-old-${RUN}`,
      occurredAt: FORTY_DAYS_AGO,
      costNanoUsd: 1_000_000_000,
    }),
    spend({
      tenantId: OTHER_PROJECT,
      requestId: `req-other-${RUN}`,
      occurredAt: THREE_DAYS_AGO,
      costNanoUsd: 5_000_000_000,
    }),
  ]);

  await insert("instant_eval_runs", [
    instantEvalRun(PROJECT_A, THREE_DAYS_AGO),
    instantEvalRun(PROJECT_B, FORTY_DAYS_AGO),
    instantEvalRun(OTHER_PROJECT, THREE_DAYS_AGO),
  ]);
  await insert("instant_eval_judgments", [
    judgment(PROJECT_A, THREE_DAYS_AGO),
    judgment(PROJECT_A, THREE_DAYS_AGO),
    judgment(PROJECT_A, TWENTY_DAYS_AGO),
    judgment(PROJECT_B, FORTY_DAYS_AGO),
    judgment(OTHER_PROJECT, THREE_DAYS_AGO),
  ]);

  // One session folded twice, which is one session.
  const refolded = `session-refolded-${RUN}`;
  await insert("coding_agent_sessions", [
    session({
      tenantId: PROJECT_A,
      sessionId: refolded,
      startedAt: THREE_DAYS_AGO,
      updatedAt: THREE_DAYS_AGO,
    }),
    session({
      tenantId: PROJECT_A,
      sessionId: refolded,
      startedAt: THREE_DAYS_AGO,
      updatedAt: NOW,
    }),
    session({
      tenantId: PROJECT_B,
      sessionId: `session-old-${RUN}`,
      startedAt: FORTY_DAYS_AGO,
      updatedAt: FORTY_DAYS_AGO,
    }),
    session({
      tenantId: OTHER_PROJECT,
      sessionId: `session-other-${RUN}`,
      startedAt: THREE_DAYS_AGO,
      updatedAt: NOW,
    }),
  ]);
});

afterAll(async () => {
  for (const tenantId of [PROJECT_A, PROJECT_B, OTHER_PROJECT]) {
    await cleanupTestData(tenantId);
  }
});

/** A figure lifetime and over both windows, the way the collector asks. */
async function windows(
  read: (input: {
    organizationId: string;
    projectIds: string[];
    since?: Date;
  }) => Promise<number>,
): Promise<[number, number, number]> {
  return await Promise.all([
    read(INSTALL),
    read({ ...INSTALL, since: SEVEN_DAYS }),
    read({ ...INSTALL, since: TWENTY_EIGHT_DAYS }),
  ]);
}

describe("given spans and traces from two projects, an old one and another install's", () => {
  describe("when spans are counted", () => {
    /** @scenario "Spans are counted from what the install stores, lifetime and over two windows" */
    it("counts the install's spans lifetime and in each window", async () => {
      const [lifetime, sevenDays, twentyEight] = await windows((input) =>
        repository.findSpanCount(input),
      );
      expect([lifetime, sevenDays, twentyEight]).toEqual([4, 2, 3]);
    });
  });

  describe("when traces are counted", () => {
    /** @scenario "Counts are reported lifetime and over two windows" */
    it("counts a trace once whichever version is newest", async () => {
      const [lifetime, sevenDays, twentyEight] = await windows((input) =>
        repository.findTraceCount(input),
      );
      expect([lifetime, sevenDays, twentyEight]).toEqual([2, 1, 1]);
    });
  });
});

describe("given a gateway ledger with a settled request and an old one", () => {
  describe("when requests and spend are read", () => {
    /** @scenario "Gateway requests and spend come from the spend ledger" */
    it("counts the settled request once at its settled cost", async () => {
      const [lifetime, sevenDays, twentyEight] = await Promise.all([
        repository.findGatewaySpend(INSTALL),
        repository.findGatewaySpend({ ...INSTALL, since: SEVEN_DAYS }),
        repository.findGatewaySpend({ ...INSTALL, since: TWENTY_EIGHT_DAYS }),
      ]);

      expect(lifetime).toEqual({ requests: 2, spendUsd: 3.5 });
      expect(sevenDays).toEqual({ requests: 1, spendUsd: 2.5 });
      expect(twentyEight).toEqual({ requests: 1, spendUsd: 2.5 });
    });

    it("dates the first request from the oldest row", async () => {
      const first = await repository.findFirstGatewayRequestAt(INSTALL);
      expect(first?.getTime()).toBe(FORTY_DAYS_AGO.getTime());
    });
  });
});

describe("given Instant Eval runs and their judgments", () => {
  describe("when they are counted", () => {
    /** @scenario "Instant Eval runs and judgments are counted" */
    it("counts runs and judgments lifetime and in each window", async () => {
      const [runs, judgments] = await Promise.all([
        windows((input) => repository.findInstantEvalRunCount(input)),
        windows((input) => repository.findInstantEvalJudgmentCount(input)),
      ]);

      expect(runs).toEqual([2, 1, 1]);
      expect(judgments).toEqual([4, 2, 3]);
    });

    it("dates the first run from the oldest row", async () => {
      const first = await repository.findFirstInstantEvalRunAt(INSTALL);
      expect(first?.getTime()).toBe(FORTY_DAYS_AGO.getTime());
    });
  });
});

describe("given coding agent sessions, one of them folded twice", () => {
  describe("when sessions are counted", () => {
    /** @scenario "Coding agent sessions are counted once each" */
    it("counts a re-folded session once", async () => {
      const [lifetime, sevenDays, twentyEight] = await windows((input) =>
        repository.findCodingAgentSessionCount(input),
      );
      expect([lifetime, sevenDays, twentyEight]).toEqual([2, 1, 1]);
    });

    /** @scenario "The ladder gains the first gateway request, Instant Eval run and coding agent session" */
    it("dates the first session from the oldest row, and null where there is none", async () => {
      const first = await repository.findFirstCodingAgentSessionAt(INSTALL);
      expect(first?.getTime()).toBe(FORTY_DAYS_AGO.getTime());

      const never = await repository.findFirstCodingAgentSessionAt({
        organizationId: ORGANIZATION_ID,
        projectIds: [`proj-usage-empty-${RUN}`],
      });
      expect(never).toBeNull();
    });
  });
});
