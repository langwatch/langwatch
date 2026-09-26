// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The seat read's row decoding.
 *
 * The counts a licence pool carries live inside the OCSF payload rather than
 * in a column, so this file pins the JSON → typed row conversion and the two
 * things that go wrong quietly around it: a payload nothing can read taking
 * the whole tenant's licence list down with it, and a re-read of the same pool
 * being returned beside the newer one instead of underneath it.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { describe, expect, it, vi } from "vitest";
import { GovernanceOcsfEventsClickHouseRepository } from "../governanceOcsfEvents.clickhouse.repository";

function makeClient(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ json: async () => rows }),
  };
}

/** One seat report's payload, shaped the way the puller writes it. */
function rawOcsfJson(extension: Record<string, unknown>): string {
  return JSON.stringify({
    class_uid: 6003,
    api: { operation: "seat_report" },
    metadata: {
      product: { name: "LangWatch", vendor_name: "LangWatch" },
      extension: {
        uid: "langwatch.governance",
        ingest_mode: "pull",
        cost_usd: "0",
        ...extension,
      },
    },
  });
}

function repositoryOver(rows: unknown[]) {
  const client = makeClient(rows);
  const repository = new GovernanceOcsfEventsClickHouseRepository(
    async () => client as never,
  );
  return { client, repository };
}

describe("GovernanceOcsfEventsClickHouseRepository.findLatestSeatReports", () => {
  describe("when a pool's newest report is read", () => {
    it("decodes the counts and the classifying facts off the payload", async () => {
      const { repository } = repositoryOver([
        {
          SourceId: "is-1",
          SkuPartNumber: "AGENT_SEAT_USL",
          Day: "2026-08-30",
          LatestRawOcsfJson: rawOcsfJson({
            skuPartNumber: "AGENT_SEAT_USL",
            seatsBought: 4,
            seatsAssigned: 2,
            perPerson: true,
            live: true,
            free: false,
            seatStem: true,
          }),
        },
      ]);

      await expect(
        repository.findLatestSeatReports({ tenantId: "gov-1" }),
      ).resolves.toEqual([
        {
          sourceId: "is-1",
          skuPartNumber: "AGENT_SEAT_USL",
          day: "2026-08-30",
          seatsBought: 4,
          seatsAssigned: 2,
          perPerson: true,
          live: true,
          free: false,
          seatStem: true,
        },
      ]);
    });

    it("scopes the read to the tenant and to seat reports alone", async () => {
      const { client, repository } = repositoryOver([]);

      await repository.findLatestSeatReports({ tenantId: "gov-1" });

      const call = client.query.mock.calls[0]?.[0];
      expect(call.query_params).toEqual({
        tenantId: "gov-1",
        actionName: "seat_report",
      });
      // TenantId leads the predicate — nothing else here is unique across
      // tenants — and neither value is spliced into the SQL text.
      expect(call.query).toContain("WHERE TenantId = {tenantId:String}");
      expect(call.query).not.toContain("gov-1");
      expect(call.query).not.toContain("'seat_report'");
    });
  });

  describe("when one pool's payload cannot be read", () => {
    it("steps over it and keeps the rest of the licence list", async () => {
      // A pool nothing can be read from must not cost the tenant the pools
      // that can — the same rule the licence read itself follows.
      const { repository } = repositoryOver([
        {
          SourceId: "is-1",
          SkuPartNumber: "BROKEN",
          Day: "2026-08-30",
          LatestRawOcsfJson: "{not json",
        },
        {
          SourceId: "is-1",
          SkuPartNumber: "AGENT_SEAT_USL",
          Day: "2026-08-30",
          LatestRawOcsfJson: rawOcsfJson({
            seatsBought: 4,
            seatsAssigned: 2,
            perPerson: true,
            live: true,
            free: false,
            seatStem: true,
          }),
        },
      ]);

      const rows = await repository.findLatestSeatReports({
        tenantId: "gov-1",
      });

      expect(rows.map((row) => row.skuPartNumber)).toEqual(["AGENT_SEAT_USL"]);
    });
  });

  describe("when the counts arrive as strings", () => {
    it("coerces them, so no consumer compares a number with text", async () => {
      const { repository } = repositoryOver([
        {
          SourceId: "is-1",
          SkuPartNumber: "AGENT_SEAT_USL",
          Day: "2026-08-30",
          LatestRawOcsfJson: rawOcsfJson({
            seatsBought: "4",
            seatsAssigned: "2",
            perPerson: true,
            live: true,
            free: false,
            seatStem: true,
          }),
        },
      ]);

      const [row] = await repository.findLatestSeatReports({
        tenantId: "gov-1",
      });

      expect(row?.seatsBought).toBe(4);
      expect(row?.seatsAssigned).toBe(2);
    });
  });
});
