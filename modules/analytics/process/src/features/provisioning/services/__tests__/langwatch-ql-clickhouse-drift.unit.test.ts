/**
 * @vitest-environment node
 * A floored twin is drift when it lacks a column of the view it is cut from.
 * @see specs/lwql/dedup-floor.feature
 * @see modules/analytics/adrs/005-evaluation-metrics-dedup-floor.md
 */
import { describe, expect, it } from "vitest";

import { flooredViewName } from "../../../../rules/lwql-dedup-floor.rules.ts";
import { pickLwqlViewByName } from "../../../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLClickHouseDriftService } from "../langwatch-ql-clickhouse-drift.service.ts";

const drift = LangWatchQLClickHouseDriftService.create();
const VIEW = "evaluation_metrics";
const TWIN = flooredViewName(VIEW);
const COLUMNS = (pickLwqlViewByName(VIEW)?.columns ?? []).map((column) => column.name);
const OLDER_COLUMNS = COLUMNS.slice(0, -1);

const rebuilt = (columns: Record<string, readonly string[]>) =>
  drift.relationsToRebuild({
    relations: [VIEW, TWIN],
    found: { relations: [VIEW, TWIN], comments: {}, columns },
    engineTables: [],
    currentComment: "current",
  });

describe("given a floored twin beside its view", () => {
  /** @scenario "A floored twin missing a column of its view is rebuilt" */
  it("rebuilds the twin when ClickHouse reports it lacking one of the view's columns", () => {
    expect(rebuilt({ [VIEW]: COLUMNS, [TWIN]: OLDER_COLUMNS })).toEqual([TWIN]);
  });

  /** @scenario "A floored twin missing a column of its view is rebuilt" */
  it("judges a twin with no column data by its view's, as ClickHouse lists none for it", () => {
    expect(rebuilt({ [VIEW]: OLDER_COLUMNS })).toEqual([VIEW, TWIN]);
  });

  /** @scenario "A floored twin missing a column of its view is rebuilt" */
  it("leaves a twin alone when its view holds every catalog column", () => {
    expect(COLUMNS.length).toBeGreaterThan(1);
    expect(rebuilt({ [VIEW]: COLUMNS })).toEqual([]);
  });
});
