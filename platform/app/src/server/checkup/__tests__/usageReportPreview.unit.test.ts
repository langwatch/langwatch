/**
 * Spec: specs/self-hosting/checkup/checkup.feature, "What we send"
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { USAGE_REPORT_SCHEMA_VERSION } from "~/server/usage-report/dictionary";
import {
  INSTANCE_ID_NOT_MINTED,
  nextNoonUtc,
  usageReportPreview,
} from "../usageReportPreview";

const prisma = {
  organization: { findMany: async () => [{ id: "org_1" }, { id: "org_2" }] },
} as unknown as PrismaClient;

describe("usageReportPreview", () => {
  describe("given an install that has reported before", () => {
    /** @scenario "The page shows the exact report the install would send" */
    it("returns the collector's payload, unchanged, and the host it goes to", async () => {
      const collect = vi.fn(async () => ({
        instance_id: "4b1c",
        traces_7d: 3,
      }));
      const preview = await usageReportPreview({
        prisma,
        disabled: false,
        endpoint: async () => "https://connect.langwatch.ai/v1/stats",
        identity: async () => ({
          instanceId: "4b1c",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          optionalMetricsOptOut: false,
          hostnameOptOut: false,
        }),
        collect,
        now: () => new Date("2026-09-21T10:00:00.000Z"),
      });

      expect(collect).toHaveBeenCalledWith({
        organizationIds: ["org_1", "org_2"],
        instanceId: "4b1c",
        firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        switches: { optional: true, hostname: true },
      });
      expect(preview.payload).toEqual({
        event: "daily_usage_stats",
        instance_id: "4b1c",
        traces_7d: 3,
      });
      expect(preview.endpoint).toBe("https://connect.langwatch.ai/v1/stats");
      expect(preview.schemaVersion).toBe(USAGE_REPORT_SCHEMA_VERSION);
      expect(preview.nextReportAt).toBe("2026-09-21T12:00:00.000Z");
    });
  });

  describe("when an administrator switched the optional category off", () => {
    /** @scenario "The two switches change the preview" */
    it("asks the collector with the optional switch off", async () => {
      const collect = vi.fn(
        async (_input: { switches: { optional: boolean; hostname: boolean } }) =>
          ({ instance_id: "4b1c" }),
      );
      const preview = await usageReportPreview({
        prisma,
        disabled: false,
        endpoint: async () => "https://app.langwatch.ai/api/track_usage",
        identity: async () => ({
          instanceId: "4b1c",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          optionalMetricsOptOut: true,
          hostnameOptOut: false,
        }),
        collect,
      });

      expect(collect.mock.calls[0]?.[0]?.switches).toEqual({
        optional: false,
        hostname: true,
      });
      expect(preview.switches).toEqual({ optional: false, hostname: true });
    });
  });

  describe("when the install has never minted an identity", () => {
    it("shows a placeholder rather than minting one", async () => {
      const collect = vi.fn(async (input: { instanceId: string }) => ({
        instance_id: input.instanceId,
      }));
      const preview = await usageReportPreview({
        prisma,
        disabled: true,
        endpoint: async () => "https://app.langwatch.ai/api/track_usage",
        identity: async () => null,
        collect,
      });

      expect(preview.payload.instance_id).toBe(INSTANCE_ID_NOT_MINTED);
      expect(preview.disabled).toBe(true);
      expect(preview.nextReportAt).toBeNull();
    });
  });
});

describe("nextNoonUtc", () => {
  it("is today's noon while it is still ahead, and tomorrow's after", () => {
    expect(
      nextNoonUtc(new Date("2026-09-21T10:00:00.000Z")).toISOString(),
    ).toBe("2026-09-21T12:00:00.000Z");
    expect(
      nextNoonUtc(new Date("2026-09-21T12:00:00.000Z")).toISOString(),
    ).toBe("2026-09-22T12:00:00.000Z");
  });
});
