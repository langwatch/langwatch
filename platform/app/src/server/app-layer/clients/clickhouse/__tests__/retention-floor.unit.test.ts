/**
 * @vitest-environment node
 *
 * Spec: specs/clickhouse/bounded-reads.feature
 */
import { describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";
import {
  RETENTION_FLOOR_MARGIN_MS,
  resolveRetentionFloorMs,
} from "../retention-floor";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

const resolverReturning = (traces: number): RetentionPolicyResolver =>
  ({ resolve: async () => ({ traces }) }) as never;

const lookbackMs = (floor: number) => NOW - floor;

describe("resolving a retention floor for a read", () => {
  describe("given a tenant whose retention exceeds the platform default", () => {
    /** @scenario "The floor follows the tenant's own retention policy" */
    it("reaches back to that tenant's retention, not the default", async () => {
      const floor = await resolveRetentionFloorMs({
        table: "evaluation_runs",
        tenantId: "project_long",
        resolver: resolverReturning(400),
        nowMs: NOW,
      });

      expect(lookbackMs(floor)).toBe(400 * DAY_MS + RETENTION_FLOOR_MARGIN_MS);
      expect(lookbackMs(floor)).toBeGreaterThan(
        PLATFORM_DEFAULT_RETENTION_DAYS * DAY_MS,
      );
    });

    /** @scenario "The floor clears the retention horizon rather than sitting on it" */
    it("clears the horizon by a margin rather than sitting on it", async () => {
      const floor = await resolveRetentionFloorMs({
        table: "evaluation_runs",
        tenantId: "project_long",
        resolver: resolverReturning(400),
        nowMs: NOW,
      });

      expect(floor).toBeLessThan(NOW - 400 * DAY_MS);
    });
  });

  describe("given the retention resolver throws", () => {
    /** @scenario "A retention lookup that fails falls back to the platform default" */
    it("falls back to the platform default rather than an unbounded read", async () => {
      const floor = await resolveRetentionFloorMs({
        table: "evaluation_runs",
        tenantId: "project_broken",
        resolver: {
          resolve: vi.fn(async () => {
            throw new Error("cascade unavailable");
          }),
        } as never,
        nowMs: NOW,
      });

      expect(lookbackMs(floor)).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS * DAY_MS + RETENTION_FLOOR_MARGIN_MS,
      );
      expect(Number.isFinite(floor)).toBe(true);
    });
  });

  describe("given no resolver is wired", () => {
    /** @scenario "A caller with no resolver wired still gets a bounded read" */
    it("still bounds the read, at the platform default", async () => {
      const floor = await resolveRetentionFloorMs({
        table: "evaluation_runs",
        tenantId: "project_plain",
        nowMs: NOW,
      });

      expect(lookbackMs(floor)).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS * DAY_MS + RETENTION_FLOOR_MARGIN_MS,
      );
    });
  });

  describe("given a tenant the cascade cannot answer for", () => {
    /** @scenario "A retention lookup that fails falls back to the platform default" */
    it("uses the platform default when the resolve returns null", async () => {
      const floor = await resolveRetentionFloorMs({
        table: "trace_summaries",
        tenantId: "project_unknown",
        resolver: { resolve: async () => null } as never,
        nowMs: NOW,
      });

      expect(lookbackMs(floor)).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS * DAY_MS + RETENTION_FLOOR_MARGIN_MS,
      );
    });
  });

  describe("given a table in a different retention category", () => {
    /** @scenario "The floor follows the tenant's own retention policy" */
    it("reads the category that table belongs to", async () => {
      const resolver = {
        resolve: async () => ({ traces: 10, scenarios: 300 }),
      } as never;

      const floor = await resolveRetentionFloorMs({
        table: "simulation_runs",
        tenantId: "project_mixed",
        resolver,
        nowMs: NOW,
      });

      expect(lookbackMs(floor)).toBe(300 * DAY_MS + RETENTION_FLOOR_MARGIN_MS);
    });
  });
});
