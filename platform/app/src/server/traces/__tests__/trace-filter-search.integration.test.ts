/**
 * The trace filter, executed: a compiled filter narrows a real trace read, and
 * it AND-s with everything the search was already able to send.
 *
 * The route-level suite proves the string is compiled and handed down; only
 * this proves the condition it produces selects the right rows. Those are
 * different failures — a fragment written against the wrong table alias, or a
 * parameter bound under a name the legacy filter also owns, compiles fine and
 * returns the wrong traces.
 *
 * The fixtures are built so no trace is findable by more than one route: one
 * error, one user, one phrase. A condition that accidentally matched
 * everything would return all five, and a clause dropped on the floor would
 * return the wrong four.
 *
 * @see specs/traces/trace-filter-api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse";
import { TRACE_FILTER_EXAMPLES } from "~/server/app-layer/traces/query-language/examples";
import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type { GetAllTracesForProjectInput } from "../types";
import { openProtections } from "./open-protections";

const tenantId = `test-filter-${nanoid()}`;
const now = Date.now();
const WINDOW = { from: now - 60_000, to: now + 60_000 };

const FAILED_FOR_ALICE = `trace-failed-alice-${nanoid()}`;
const FAILED_FOR_BOB = `trace-failed-bob-${nanoid()}`;
const CLEAN_FOR_ALICE = `trace-clean-alice-${nanoid()}`;
const FAILED_MENTIONING_REFUND = `trace-failed-refund-${nanoid()}`;
const CLEAN_FOR_NOBODY = `trace-clean-nobody-${nanoid()}`;

function traceRow({
  traceId,
  failed,
  userId,
  input = "nothing relevant here",
}: {
  traceId: string;
  failed: boolean;
  userId?: string;
  input?: string;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: userId ? { "langwatch.user_id": userId } : {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    LastEventOccurredAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: JSON.stringify({ type: "text", value: input }),
    ComputedOutput: JSON.stringify({ type: "text", value: "done" }),
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: failed,
    ContainsOKStatus: !failed,
    Models: [],
    TraceName: "checkout flow",
  };
}

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForTenant: vi.fn(),
}));

vi.mock("~/server/app-layer/app", async () => {
  const clients = await import("~/server/clickhouse/clickhouseClient");
  const app = () => ({
    clickhouse: {
      enabled: true,
      resolveClient: (tenant: string) =>
        clients.getClickHouseClientForTenant(tenant),
      resolveOrganizationClient: async () => {
        throw new Error("no organization client in this suite");
      },
      allInstances: async () => [],
    },
  });
  return { getApp: app, tryGetApp: app };
});

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn().mockResolvedValue({}) },
    annotation: { findMany: vi.fn().mockResolvedValue([]) },
    annotationScore: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

/** The ids a search returns, sorted so order is never the assertion. */
async function search({
  filter,
  filters = {},
  query,
  traceIds,
}: {
  filter?: string;
  filters?: Record<string, unknown>;
  query?: string;
  traceIds?: string[];
}): Promise<string[]> {
  const input = {
    projectId: tenantId,
    startDate: WINDOW.from,
    endDate: WINDOW.to,
    filters,
    pageSize: 100,
    ...(query === undefined ? {} : { query }),
    ...(traceIds === undefined ? {} : { traceIds }),
  } as GetAllTracesForProjectInput;

  const compiled =
    filter === undefined
      ? undefined
      : translateFilterToClickHouse(filter, tenantId, WINDOW);
  if (filter !== undefined && !compiled) {
    throw new Error(`the fixture filter compiled to nothing: ${filter}`);
  }

  const result = await service.getAllTracesForProject(input, openProtections, {
    ...(compiled ? { filterWhere: compiled } : {}),
  });
  return result.groups
    .flat()
    .map((trace) => trace.trace_id)
    .sort();
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  vi.mocked(getClickHouseClientForTenant).mockResolvedValue(ch);
  service = new ClickHouseTraceService({
    prisma: prisma as ConstructorParameters<
      typeof ClickHouseTraceService
    >[0]["prisma"],
  });

  await ch.insert({
    table: "trace_summaries",
    values: [
      traceRow({ traceId: FAILED_FOR_ALICE, failed: true, userId: "alice" }),
      traceRow({ traceId: FAILED_FOR_BOB, failed: true, userId: "bob" }),
      traceRow({ traceId: CLEAN_FOR_ALICE, failed: false, userId: "alice" }),
      traceRow({
        traceId: FAILED_MENTIONING_REFUND,
        failed: true,
        userId: "carol",
        input: "please process my refund",
      }),
      traceRow({ traceId: CLEAN_FOR_NOBODY, failed: false }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  await stopTestContainers();
});

describe("every filter example the reference publishes", () => {
  /**
   * Compiling is not running. A fragment can parse, pass the semantic check and
   * still be refused by ClickHouse for a type it cannot compare or a function
   * that does not exist on this schema, and the reader of a published example
   * finds that out one round trip later. So each one is executed here, against
   * the same tables the search reads.
   *
   * The assertion is that the database accepted it, not what came back: these
   * fixtures are built for the narrowing tests above, and pinning a row count
   * per example would make this suite a second, worse copy of them.
   */
  /** @scenario "Every published filter example runs against the real schema" */
  it.each(
    TRACE_FILTER_EXAMPLES.map((example) => [example.id, example.text]),
  )("runs %s", async (_id, text) => {
    const compiled = translateFilterToClickHouse(text, tenantId, WINDOW);
    expect(compiled).not.toBeNull();
    await expect(
      ch.query({
        query: `SELECT count() AS matches FROM trace_summaries ts WHERE TenantId = {tenantId:String} AND ${compiled?.sql}`,
        query_params: compiled?.params ?? {},
        format: "JSONEachRow",
      }),
    ).resolves.toBeDefined();
  });
});

describe("a trace search carrying a compiled trace filter", () => {
  describe("when only the filter narrows", () => {
    /** @scenario "A filter string narrows the search" */
    it("returns exactly the traces the filter selects", async () => {
      expect(await search({ filter: "status:error" })).toEqual(
        [FAILED_FOR_ALICE, FAILED_FOR_BOB, FAILED_MENTIONING_REFUND].sort(),
      );
    });

    it("returns everything when no filter is given", async () => {
      expect(await search({})).toHaveLength(5);
    });

    it("reaches an attribute the named fields do not cover", async () => {
      expect(
        await search({ filter: "trace.attribute.langwatch.user_id:carol" }),
      ).toEqual([FAILED_MENTIONING_REFUND]);
    });
  });

  describe("when the legacy filter map narrows too", () => {
    /** @scenario "A filter combines with the legacy filter map rather than replacing it" */
    it("returns only the traces both agree on", async () => {
      expect(
        await search({
          filter: "status:error",
          filters: { "metadata.user_id": ["alice"] },
        }),
      ).toEqual([FAILED_FOR_ALICE]);
    });

    it("does not widen the legacy filter's own answer", async () => {
      expect(
        await search({ filters: { "metadata.user_id": ["alice"] } }).then(
          (ids) => ids.sort(),
        ),
      ).toEqual([CLEAN_FOR_ALICE, FAILED_FOR_ALICE].sort());
    });
  });

  describe("when free text and an explicit id list narrow as well", () => {
    /** @scenario "A filter combines with free text and with an explicit trace id list" */
    it("returns only the traces every condition agrees on", async () => {
      expect(
        await search({
          filter: "status:error",
          query: "refund",
          traceIds: [FAILED_MENTIONING_REFUND, CLEAN_FOR_ALICE],
        }),
      ).toEqual([FAILED_MENTIONING_REFUND]);
    });

    it("returns nothing when the conditions cannot hold together", async () => {
      expect(
        await search({
          filter: "status:error",
          query: "refund",
          traceIds: [CLEAN_FOR_ALICE],
        }),
      ).toEqual([]);
    });
  });
});
