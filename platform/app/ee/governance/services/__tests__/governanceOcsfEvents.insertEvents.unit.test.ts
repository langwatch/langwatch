// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The audit write of a pulled page.
 *
 * A run's kept events arrive as one array and each carries its whole raw
 * payload, so the two things that go wrong quietly here are a single INSERT
 * growing without bound, and a server-side rejection the caller never hears
 * about because the write did not wait for the flush.
 *
 * Spec: specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
 */
import { describe, expect, it, vi } from "vitest";
import {
  type GovernanceOcsfEventInput,
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../governanceOcsfEvents.clickhouse.repository";

function makeRepository() {
  const insert = vi.fn().mockResolvedValue(undefined);
  const client = { insert };
  const repository = new GovernanceOcsfEventsClickHouseRepository(
    async () => client as never,
  );
  return { client, insert, repository };
}

function rowsFor({
  count,
  tenantId = "gov-1",
}: {
  count: number;
  tenantId?: string;
}): GovernanceOcsfEventInput[] {
  return Array.from({ length: count }, (_, index) => ({
    tenantId,
    eventId: `evt-${index}`,
    traceId: `trace-${index}`,
    sourceId: "is-1",
    sourceType: "microsoft_graph",
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId: OCSF_SEVERITY.INFO,
    eventTime: new Date("2026-08-30T00:00:00.000Z"),
    actorUserId: "",
    actorEmail: "",
    actorEnduserId: "",
    actionName: "invoke",
    targetName: "",
    anomalyAlertId: "",
    rawOcsfJson: JSON.stringify({ class_uid: 6003 }),
  }));
}

describe("GovernanceOcsfEventsClickHouseRepository.insertEvents", () => {
  describe("given a page larger than one chunk", () => {
    it("splits the page into sequential inserts of at most the chunk size", async () => {
      const { insert, repository } = makeRepository();

      await repository.insertEvents(rowsFor({ count: 1201 }));

      expect(insert).toHaveBeenCalledTimes(3);
      expect(
        insert.mock.calls.map(([options]) => options.values.length),
      ).toEqual([500, 500, 201]);
    });

    it("keeps the rows in order across the chunks", async () => {
      const { insert, repository } = makeRepository();

      await repository.insertEvents(rowsFor({ count: 1201 }));

      const inserted = insert.mock.calls.flatMap(
        ([options]) => options.values as { EventId: string }[],
      );
      expect(inserted).toHaveLength(1201);
      expect(inserted[0]!.EventId).toBe("evt-0");
      expect(inserted[500]!.EventId).toBe("evt-500");
      expect(inserted[1200]!.EventId).toBe("evt-1200");
    });

    it("waits for the async flush of every chunk so a rejection is not lost", async () => {
      const { insert, repository } = makeRepository();

      await repository.insertEvents(rowsFor({ count: 1201 }));

      for (const [options] of insert.mock.calls) {
        expect(options.format).toBe("JSONEachRow");
        expect(options.clickhouse_settings).toMatchObject({
          async_insert: 1,
          wait_for_async_insert: 1,
        });
      }
    });
  });

  describe("when a chunk after the first is rejected", () => {
    it("surfaces the rejection to the caller", async () => {
      const { insert, repository } = makeRepository();
      insert
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("TOO_MANY_SIMULTANEOUS_QUERIES"))
        .mockResolvedValue(undefined);

      await expect(
        repository.insertEvents(rowsFor({ count: 1201 })),
      ).rejects.toThrow("TOO_MANY_SIMULTANEOUS_QUERIES");
    });
  });

  describe("given no rows", () => {
    it("issues no statement at all", async () => {
      const { insert, repository } = makeRepository();

      await repository.insertEvents([]);

      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe("given rows of two tenants", () => {
    it("refuses the page rather than writing part of it", async () => {
      const { insert, repository } = makeRepository();
      const mixed = [
        ...rowsFor({ count: 1, tenantId: "gov-1" }),
        ...rowsFor({ count: 1, tenantId: "gov-2" }),
      ];

      await expect(repository.insertEvents(mixed)).rejects.toThrow(
        /same tenant/,
      );
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
