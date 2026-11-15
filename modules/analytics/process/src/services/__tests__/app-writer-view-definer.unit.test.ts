/**
 * ADR-202 Decided 16: every materialised view a writer table feeds runs as SQL SECURITY DEFINER,
 * read from the shipped goose migrations replayed in order, so a view created again without it
 * fails.
 * @see specs/clickhouse/app-writer-identity.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { APP_WRITER_TABLES } from "@langwatch/clickhouse-migrations";
import { describe, expect, it } from "vitest";

import { CLICKHOUSE_MIGRATIONS_DIRECTORY } from "./support/clickhouse-migration-tables.ts";

interface Migration {
  readonly name: string;
  readonly text: string;
}

interface ViewState {
  readonly sources: readonly string[];
  readonly definer: boolean;
  readonly migration: string;
}

const NAME = String.raw`\x60?(?:[A-Za-z_]\w*\x60?\.\x60?)?([A-Za-z_]\w*)\x60?`;
const CREATE_VIEW = new RegExp(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\s+(IF\s+NOT\s+EXISTS\s+)?${NAME}`,
  "i",
);
const DROP = new RegExp(String.raw`^DROP\s+(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?${NAME}`, "i");
const RENAME = new RegExp(String.raw`^RENAME\s+TABLE\s+${NAME}\s+TO\s+${NAME}`, "i");
const EXCHANGE = new RegExp(String.raw`^EXCHANGE\s+TABLES\s+${NAME}\s+AND\s+${NAME}`, "i");
const MODIFY_SECURITY = new RegExp(
  String.raw`^ALTER\s+TABLE\s+${NAME}\s+MODIFY\s+SQL\s+SECURITY\s+(DEFINER|INVOKER|NONE)\b`,
  "i",
);
const MODIFY_QUERY = new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}\s+MODIFY\s+QUERY\b`, "i");
const READS = new RegExp(String.raw`\b(?:FROM|JOIN)\s+${NAME}`, "gi");

/** The `+goose Up` half as statements, comments removed and the database prefix dropped. */
function upStatements(text: string): string[] {
  const down = text.indexOf("+goose Down");
  return (down < 0 ? text : text.slice(0, down))
    .replace(/--[^\n]*/g, "")
    .replace(/\$\{[A-Z0-9_]+:-([^}]*)\}/g, "$1")
    .replace(/\$\{[A-Z0-9_]+\}\.?/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const sourcesOf = (statement: string) =>
  [...statement.matchAll(READS)].map((match) => match[1]!.toLowerCase());

/** The materialised views the migrations leave behind, each with its sources and security. */
function replayViews(migrations: readonly Migration[]): Map<string, ViewState> {
  const views = new Map<string, ViewState>();
  for (const { name: migration, text } of migrations) {
    for (const statement of upStatements(text)) {
      const created = CREATE_VIEW.exec(statement);
      const dropped = DROP.exec(statement);
      const renamed = RENAME.exec(statement);
      const exchanged = EXCHANGE.exec(statement);
      const secured = MODIFY_SECURITY.exec(statement);
      const requeried = MODIFY_QUERY.exec(statement);
      if (created) {
        const view = created[2]!.toLowerCase();
        if (created[1] && views.has(view)) continue;
        const definer = /\bSQL\s+SECURITY\s+DEFINER\b/i.test(statement);
        views.set(view, { sources: sourcesOf(statement), definer, migration });
      } else if (dropped) views.delete(dropped[1]!.toLowerCase());
      else if (renamed) {
        const state = views.get(renamed[1]!.toLowerCase());
        views.delete(renamed[1]!.toLowerCase());
        if (state) views.set(renamed[2]!.toLowerCase(), state);
      } else if (exchanged) {
        const [left, right] = [exchanged[1]!.toLowerCase(), exchanged[2]!.toLowerCase()];
        const [leftState, rightState] = [views.get(left), views.get(right)];
        views.delete(left);
        views.delete(right);
        if (rightState) views.set(left, rightState);
        if (leftState) views.set(right, leftState);
      } else if (secured && views.has(secured[1]!.toLowerCase())) {
        const view = secured[1]!.toLowerCase();
        const definer = secured[2]!.toUpperCase() === "DEFINER";
        views.set(view, { ...views.get(view)!, definer, migration });
      } else if (requeried && views.has(requeried[1]!.toLowerCase())) {
        const view = requeried[1]!.toLowerCase();
        views.set(view, { ...views.get(view)!, sources: sourcesOf(statement) });
      }
    }
  }
  return views;
}

/** The views a writer table feeds that still check the inserter's SELECT, by name. */
function viewsWithoutDefiner(views: Map<string, ViewState>): string[] {
  const writerTables = new Set(APP_WRITER_TABLES);
  return [...views]
    .filter(([, state]) => state.sources.some((source) => writerTables.has(source)))
    .filter(([, state]) => !state.definer)
    .map(([view, state]) => `${view} (${state.migration})`);
}

const shippedMigrations: Migration[] = readdirSync(CLICKHOUSE_MIGRATIONS_DIRECTORY)
  .filter((file) => file.endsWith(".sql"))
  .toSorted()
  .map((name) => ({
    name,
    text: readFileSync(join(CLICKHOUSE_MIGRATIONS_DIRECTORY, name), "utf8"),
  }));

describe("given the shipped ClickHouse migrations replayed in order", () => {
  const views = replayViews(shippedMigrations);

  describe("when a materialised view reads from one of the writer's tables", () => {
    /** @scenario "Every view a writer table feeds runs as its definer" */
    it("finds the three views the writer's tables feed", () => {
      const writerTables = new Set(APP_WRITER_TABLES);
      const fed = [...views]
        .filter(([, state]) => state.sources.some((source) => writerTables.has(source)))
        .map(([view]) => view)
        .toSorted();
      expect(fed).toEqual([
        "dspy_steps_id_index_mv",
        "gateway_budget_ledger_events_id_index_mv",
        "gateway_budget_scope_totals_mv",
      ]);
    });

    /** @scenario "Every view a writer table feeds runs as its definer" */
    it("runs each as SQL SECURITY DEFINER", () => {
      expect(viewsWithoutDefiner(views)).toEqual([]);
    });
  });

  describe("when a later migration creates such a view again without SQL SECURITY DEFINER", () => {
    /** @scenario "Every view a writer table feeds runs as its definer" */
    it("fails the guard naming the view and the migration", () => {
      const recreated: Migration = {
        name: "99999_recreate_dspy_steps_id_index_mv.sql",
        text: [
          "-- +goose Up",
          "DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.dspy_steps_id_index_mv;",
          "CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.dspy_steps_id_index_mv",
          "TO ${CLICKHOUSE_DATABASE}.dspy_steps_id_index AS",
          "SELECT TenantId FROM ${CLICKHOUSE_DATABASE}.dspy_steps GROUP BY TenantId;",
        ].join("\n"),
      };
      expect(viewsWithoutDefiner(replayViews([...shippedMigrations, recreated]))).toEqual([
        "dspy_steps_id_index_mv (99999_recreate_dspy_steps_id_index_mv.sql)",
      ]);
    });
  });
});
