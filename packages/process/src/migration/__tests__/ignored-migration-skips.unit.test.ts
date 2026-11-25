/**
 * @see specs/server/feature-configuration.feature
 */
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { processOwner } from "../../owner.ts";
import type { ServerLogger } from "../../server.ts";
import { warnIgnoredMigrationSkips } from "../ignored-migration-skips.ts";

function warningsFor(environment: Record<string, string | undefined>) {
  const lines: { fields: object; message: string }[] = [];
  const record = (fields: object, message: string) => lines.push({ fields, message });
  const logger: ServerLogger = { info: record, warn: record, error: record };
  const skips = parseProcessConfig({ owners: [processOwner], environment }).process;
  warnIgnoredMigrationSkips({ skips, logger });
  return lines;
}

describe("the previous release's migrate skips at worker boot", () => {
  describe("given SKIP_PRISMA_MIGRATE and SKIP_CLICKHOUSE_MIGRATE are both true", () => {
    /** @scenario "A worker told to skip migrations says the skip is ignored" */
    it("logs one warning naming both as ignored", () => {
      const lines = warningsFor({ SKIP_PRISMA_MIGRATE: "true", SKIP_CLICKHOUSE_MIGRATE: "TRUE" });
      expect(lines).toHaveLength(1);
      expect(lines[0]?.fields).toEqual({
        ignored: ["SKIP_PRISMA_MIGRATE", "SKIP_CLICKHOUSE_MIGRATE"],
      });
    });
  });

  describe("given only one is true", () => {
    /** @scenario "A worker told to skip migrations says the skip is ignored" */
    it("names only that one", () => {
      expect(warningsFor({ SKIP_CLICKHOUSE_MIGRATE: "true" })[0]?.fields).toEqual({
        ignored: ["SKIP_CLICKHOUSE_MIGRATE"],
      });
    });
  });

  describe("given neither is set, or they are blank or false", () => {
    it("says nothing", () => {
      expect(warningsFor({})).toEqual([]);
      expect(warningsFor({ SKIP_PRISMA_MIGRATE: "", SKIP_CLICKHOUSE_MIGRATE: "false" })).toEqual(
        [],
      );
    });
  });
});
