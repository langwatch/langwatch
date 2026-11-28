/**
 * @vitest-environment node
 * evaluation_metrics deduplicates every evaluation of the tenant unless the read is bounded below
 * on OccurredAt; then the executor sends it to the floored view, which must return the same rows.
 * Each query's rows are pinned to what the whole-history view returns.
 * @see specs/lwql/dedup-floor.feature
 * @see modules/analytics/adrs/005-evaluation-metrics-dedup-floor.md
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { floorLangWatchQLDedup } from "../../rules/lwql-dedup-floor.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import {
  expectRestrictedIdentity,
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
  TENANT_A,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();
const VIEWS = LWQL_VIEW_CATALOG.filter((view) => view.name === "evaluation_metrics");

const TENANT = TENANT_A.tenantId;
const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;
const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START),
  dashboard_context_period_end: at(PERIOD_END),
};
const START = "{dashboard_context_period_start:DateTime}";
const END = "{dashboard_context_period_end:DateTime}";

/** Each evaluation's versions, oldest first; a version's day is its running-max OccurredAt. */
const EVALUATIONS: Record<string, { day: number; passed: boolean }[]> = {
  "e-single": [{ day: 1, passed: true }],
  "e-before": [
    { day: -1, passed: false },
    { day: 2, passed: true },
  ],
  "e-after": [
    { day: 3, passed: false },
    { day: 8, passed: true },
  ],
  "k-in": [
    { day: 1, passed: false },
    { day: 4, passed: true },
  ],
  "k-early": [
    { day: -3, passed: false },
    { day: -2, passed: true },
  ],
  "k-late": [
    { day: -1, passed: false },
    { day: 9, passed: true },
  ],
};

function evaluationRows(): Record<string, unknown>[] {
  return Object.entries(EVALUATIONS).flatMap(([id, versions]) =>
    versions.map(({ day, passed }, n) => ({
      TenantId: TENANT,
      EvaluationId: id,
      Version: "1",
      OccurredAt: at(PERIOD_START + day * DAY),
      CreatedAt: at(PERIOD_START + (versions[0]?.day ?? day) * DAY),
      UpdatedAt: at(PERIOD_START + (day + 0.01 + n) * DAY),
      EvaluatorType: "llm",
      EvaluatorName: "Quality",
      Status: "processed",
      IsGuardrail: false,
      Passed: passed,
      TraceId: `trace-${id}`,
      Origin: "application",
    })),
  );
}

const passedRows = (ids: string[]) => ids.map((id) => ({ EvaluationId: id, Passed: true }));

describe("given evaluations whose versions sit before, inside and after the window", () => {
  let harness: LangWatchQLClickHouseHarness;
  let client: ClickHouseClient;

  async function rows(sql: string): Promise<Record<string, unknown>[]> {
    const result = await client.query({
      query: sql,
      query_params: PARAMETERS,
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  }

  /** The rows as written (the whole-history dedup) and as the executor sends the statement. */
  async function both(sql: string) {
    const sent = floorLangWatchQLDedup({ sql, database: harness.names.database, views: VIEWS });
    return { written: await rows(sql), sent: await rows(sent), isFloored: sent !== sql };
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "evaluation-floor", facts: "migrated" });
    const { names, factDatabase: facts } = harness;
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names,
        sourceDatabase: facts,
        views: VIEWS,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    await harness.applyAccessModel({ views: VIEWS, sourceDatabase: facts });
    await harness.admin.insert({
      table: `${facts}.evaluation_analytics`,
      format: "JSONEachRow",
      values: evaluationRows(),
    });
    client = createClient({
      ...harness.restrictedConnection(),
      database: names.database,
      clickhouse_settings: { [names.tenantSetting]: harness.tenantA.keyHash },
    });
    await expectRestrictedIdentity({ client, names });
  }, 600_000);

  afterAll(async () => {
    await client?.close();
    await harness?.stop();
  });

  /** @scenario "A read bounded below on OccurredAt deduplicates only from that bound" */
  it("returns the latest version inside the window and never a version its newer one left", async () => {
    const { written, sent, isFloored } = await both(
      `SELECT EvaluationId, Passed FROM evaluation_metrics ` +
        `WHERE OccurredAt >= ${START} AND OccurredAt < ${END} ORDER BY EvaluationId`,
    );

    expect(written).toEqual(passedRows(["e-before", "e-single", "k-in"]));
    expect(isFloored).toBe(true);
    expect(sent).toEqual(written);
  });

  /** @scenario "A bound in another time zone floors from the same instant" */
  it("floors a bound written in Tokyo time from the instant it names", async () => {
    // Day 1 in UTC, written as Tokyo's wall clock (UTC+9, no DST): e-single sits exactly on it.
    const tokyoDayOne = `toDateTime('${at(PERIOD_START + DAY + 9 * 3_600_000)}', 'Asia/Tokyo')`;
    const { written, sent, isFloored } = await both(
      `SELECT EvaluationId, Passed FROM evaluation_metrics ` +
        `WHERE OccurredAt >= ${tokyoDayOne} AND OccurredAt < ${END} ORDER BY EvaluationId`,
    );

    expect(written).toEqual(passedRows(["e-before", "e-single", "k-in"]));
    expect(isFloored).toBe(true);
    expect(sent).toEqual(written);
  });

  /** @scenario "A read bounded on another column keeps the whole-history dedup" */
  it("reads a window on UpdatedAt from the whole-history dedup", async () => {
    const { written, sent, isFloored } = await both(
      `SELECT EvaluationId, Passed FROM evaluation_metrics WHERE UpdatedAt >= ${START} ORDER BY EvaluationId`,
    );

    expect(written).toEqual(passedRows(["e-after", "e-before", "e-single", "k-in", "k-late"]));
    expect(isFloored).toBe(false);
    expect(sent).toEqual(written);
  });

  /** @scenario "A read with no window keeps the whole-history dedup" */
  it("reads every evaluation's latest version when there is no window", async () => {
    // The migrated facts hold the harness's own evaluations too, so name this suite's.
    const ids = Object.keys(EVALUATIONS)
      .map((id) => `'${id}'`)
      .join(", ");
    const { written, sent, isFloored } = await both(
      `SELECT EvaluationId, Passed FROM evaluation_metrics WHERE EvaluationId IN (${ids}) ORDER BY EvaluationId`,
    );

    expect(written).toEqual(passedRows(Object.keys(EVALUATIONS).toSorted()));
    expect(isFloored).toBe(false);
    expect(sent).toEqual(written);
  });

  /** @scenario "Of two evaluations, only the one whose latest version is inside the window is read" */
  it("reads only the key whose latest version is inside, beside one before and one after", async () => {
    const { written, sent, isFloored } = await both(
      `SELECT e.EvaluationId AS EvaluationId, e.Passed AS Passed FROM evaluation_metrics AS e ` +
        `WHERE e.OccurredAt >= ${START} AND e.OccurredAt < ${END} ` +
        `AND e.EvaluationId IN ('k-in', 'k-early', 'k-late') ORDER BY EvaluationId`,
    );

    expect(written).toEqual(passedRows(["k-in"]));
    expect(isFloored).toBe(true);
    expect(sent).toEqual(written);
  });
});
