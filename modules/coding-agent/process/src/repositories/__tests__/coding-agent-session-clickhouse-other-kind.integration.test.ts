/**
 * Runs findOtherSessionKind's index read and two-probe SQL against real ClickHouse.
 * @see modules/coding-agent/specs/coding-agent-session-stored.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  readyIdIndexedClientDouble,
  vendorQueryClient,
} from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { session } from "../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import type { CodingAgentClock } from "../../services/coding-agent-clock.service.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { CODING_AGENT_ID_INDEXES } from "../clickhouse/clickhouse.coding-agent-id-indexes.database.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse/clickhouse.coding-agent-session.repository.ts";
import {
  type OtherSessionKind,
  SessionIdIndexNotReadyError,
} from "../coding-agent-session.repository.ts";

const clickHouseUrl = testClickHouseUrl();
const baseMs = Date.now();
const tag = randomUUID();
const tenantFor = (name: string) => `${tag}-${name}`;
const tenants = ["main", "helpers", "none", "both", "refold", "other", "empty"].map(tenantFor);

class FixedClock implements CodingAgentClock {
  nowMs(): number {
    return baseMs;
  }
}

let ch: ClickHouseClient;
let sessions: CodingAgentSessionClickHouseRepository;
/** The same repository while the id index's fill has not finished. */
let unready: CodingAgentSessionClickHouseRepository;

const repositoryOver = (clickhouse: ClickHouseQueryClient) =>
  CodingAgentSessionClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 30,
    metrics: NoopCodingAgentReadMetricsService.create(),
    clock: new FixedClock(),
  });

beforeAll(async () => {
  if (clickHouseUrl === null) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  const vendor = vendorQueryClient({ vendor: ch, indexes: CODING_AGENT_ID_INDEXES });
  sessions = repositoryOver(
    await readyIdIndexedClientDouble({
      indexes: CODING_AGENT_ID_INDEXES,
      driver: {
        execute: async (request) => vendor.query(request),
        insert: async (request) => vendor.insert(request),
      },
    }),
  );
  unready = repositoryOver(vendor);
});

afterAll(async () => {
  if (clickHouseUrl === null) return;
  for (const table of ["coding_agent_sessions", "coding_agent_sessions_id_index"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId IN {tenants:Array(String)}`,
      query_params: { tenants },
    });
  }
  await ch.close();
});

const store = (tenantId: string, sessionId: string, auxiliary: boolean) =>
  sessions.upsert(session({ tenantId, sessionId, startedAtMs: baseMs, auxiliary }), 30, []);

const kindOf = (tenantId: string, excludeSessionIds: string[]): Promise<OtherSessionKind> =>
  sessions.findOtherSessionKind({ tenantId, excludeSessionIds });

describe.skipIf(clickHouseUrl === null)("coding_agent_sessions other-session kind", () => {
  it("reads a main session as main", async () => {
    const tenantId = tenantFor("main");
    await store(tenantId, "m1", false);

    expect(await kindOf(tenantId, ["x"])).toBe("main");
  });

  it("reads a helper-only project as helpers_only", async () => {
    const tenantId = tenantFor("helpers");
    await store(tenantId, "h1", true);

    expect(await kindOf(tenantId, ["x"])).toBe("helpers_only");
  });

  it("reads none when only the excluded sessions remain", async () => {
    const tenantId = tenantFor("none");
    await store(tenantId, "m1", false);

    expect(await kindOf(tenantId, ["m1"])).toBe("none");
  });

  it("reads a helper plus a main session as main", async () => {
    const tenantId = tenantFor("both");
    await store(tenantId, "h1", true);
    await store(tenantId, "m1", false);

    expect(await kindOf(tenantId, ["x"])).toBe("main");
  });

  it("reads another tenant's sessions as none", async () => {
    await store(tenantFor("other"), "m1", false);

    expect(await kindOf(tenantFor("empty"), ["x"])).toBe("none");
  });

  // Row-level probe, no dedup: the older non-auxiliary version still matches. That can only
  // mistake a helper for main, which reads as "not first" (the safe side).
  it("reads a helper whose earlier version was not yet auxiliary as main", async () => {
    const tenantId = tenantFor("refold");
    await store(tenantId, "h1", false);
    await store(tenantId, "h1", true);

    expect(await kindOf(tenantId, ["x"])).toBe("main");
  });

  /** @scenario "A history check fails closed while the session id index is not ready" */
  it("refuses rather than scan while the session id index is not ready", async () => {
    await expect(
      unready.findOtherSessionKind({ tenantId: tenantFor("main"), excludeSessionIds: ["x"] }),
    ).rejects.toBeInstanceOf(SessionIdIndexNotReadyError);
  });
});
