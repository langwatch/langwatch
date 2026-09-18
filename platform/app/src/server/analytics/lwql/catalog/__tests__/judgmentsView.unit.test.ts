/**
 * The `judgments` dataset's catalog entry.
 *
 * The entry is what three consumers read: the schema endpoint that publishes
 * the dataset, the validator that decides whether a caller may name it, and
 * the view generator that renders it in ClickHouse. Three properties of it are
 * decisions rather than details, so each one is pinned here.
 *
 * @see ../lwqlViews.ts
 * @see ../../../../../../../specs/analytics/lwql-judgments-view.feature
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../../provisioning/accessModel";
import { lwqlSourceTables } from "../../provisioning/catalogStatements";
import { lwqlViewByName } from "../lwqlViews";
import { isContentGated } from "../types";

const MANIFEST_PATH = fileURLToPath(
  new URL(
    "../../../../../../../../infra/clickhouse-serverless/internal/render/lwql_catalog.json",
    import.meta.url,
  ),
);

/** Only the fields the source-table derivation reads. */
const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

function judgments() {
  const view = lwqlViewByName("judgments");
  if (!view) throw new Error("the judgments dataset is not in the catalog");
  return view;
}

describe("given the judgments dataset in the LangWatchQL catalog", () => {
  describe("when the catalog entry is read", () => {
    /** @scenario The dataset is listed for every caller */
    it("carries no content gate, on the dataset or on any column", () => {
      const view = judgments();

      expect(view.gates).toEqual([]);
      expect(view.columns.filter(isContentGated)).toEqual([]);
    });

    /** @scenario The dataset declares its join keys and its time column */
    it("joins on the tenant and the trace id, and prunes on the write time", () => {
      const view = judgments();

      expect(view.joinKeys).toEqual(["TenantId", "TraceId"]);
      expect(view.timeColumn).toBe("CreatedAt");
      // A caller who writes the time predicate the schema publishes has to
      // land on the partition key, or the pruning the column promises does not
      // happen. Migration 00097 partitions by `toYYYYMM(CreatedAt)`.
      expect(view.columns.map((column) => column.name)).toContain(
        view.timeColumn,
      );
    });
  });

  describe("when the shipped catalog manifest is compared with the code", () => {
    /** @scenario The published catalog and the code catalog agree */
    it("lists the dataset as a granted view and its table as a granted read", () => {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
        sourceTables: string[];
        viewNames: string[];
      };

      expect(manifest.viewNames).toContain("judgments");
      expect(manifest.sourceTables).toContain("instant_eval_judgments");
      expect(
        lwqlSourceTables({
          names: NAMES,
          sourceDatabase: NAMES.database,
        }).map((table) => table.table),
      ).toContain(judgments().sourceTable);
    });
  });
});
