/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-command.feature
 */
import { describe, expect, it } from "vitest";

import { blocksRelease, newlyHeld, withHeldReports } from "../held-targets.ts";
import type { SchemaTargetReport } from "../schema-applier.ts";

const clickhouse = (target: string, ok: boolean): SchemaTargetReport => ({
  engine: "clickhouse",
  target,
  ok,
  error: ok ? null : "Code: 210. Connection refused",
  applied: ok ? new Set(["clickhouse:00001"]) : null,
});

describe("newlyHeld", () => {
  describe("when the shared target applied and a private target failed", () => {
    it("holds the private target with its error", () => {
      const reports = [clickhouse("shared", true), clickhouse("private:org_1", false)];
      expect(newlyHeld({ reports, held: new Map() })).toEqual(
        new Map([["private:org_1", "Code: 210. Connection refused"]]),
      );
    });
  });

  describe("when the shared target failed", () => {
    it("never holds the shared target", () => {
      const reports = [clickhouse("shared", false), clickhouse("private:org_1", true)];
      expect(newlyHeld({ reports, held: new Map() })).toEqual(new Map());
    });
  });

  describe("when no ClickHouse target applied", () => {
    /** @scenario "Every ClickHouse target failing fails the run as before" */
    it("holds nothing, so the run fails", () => {
      const reports = [clickhouse("private:org_1", false), clickhouse("private:org_2", false)];
      expect(newlyHeld({ reports, held: new Map() })).toEqual(new Map());
    });
  });
});

describe("withHeldReports", () => {
  describe("when the apply skipped a held target", () => {
    it("reports it failed with the error that held it", () => {
      const held = new Map([["private:org_1", "Code: 210. Connection refused"]]);
      const reports = withHeldReports({ reports: [clickhouse("shared", true)], held });
      expect(reports.at(-1)).toEqual(clickhouse("private:org_1", false));
      expect(reports.some((report) => blocksRelease({ report, held }))).toBe(false);
    });
  });
});
