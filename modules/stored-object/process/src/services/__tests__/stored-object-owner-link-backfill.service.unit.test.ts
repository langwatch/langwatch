/**
 * @vitest-environment node
 * Objects stored before owner links get a link to the owner that stored them, over memory backends.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStoredObjectOwnerLinkRepository } from "../../repositories/memory/memory.stored-object-owner-link.repository.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import type { StoredObjectRecord } from "../../repositories/stored-object-record.repository.ts";
import { StoredObjectOwnerLinkBackfillService } from "../stored-object-owner-link-backfill.service.ts";
import { StoredObjectRetentionService } from "../stored-object-retention.service.ts";

const PROJECT = "project_backfill" as StoredObjectProjectId;
const DAY_0 = Temporal.Instant.from("2026-11-01T00:00:00.000Z");

function dayOf(day: number): Instant {
  return DAY_0.add({ hours: day * 24 });
}

function record(overrides: Partial<StoredObjectRecord> & { id: string }): StoredObjectRecord {
  return {
    tenantId: PROJECT,
    status: "available",
    purpose: "trace_content",
    ownerKind: "trace",
    ownerId: `trace-of-${overrides.id}`,
    filename: "image.png",
    sha256: "a".repeat(64),
    byteLength: 7,
    mediaType: "image/png",
    mediaTypeVerified: true,
    storage: null,
    generation: 1,
    audiences: ["traces:view"],
    expiresAt: null,
    availableAt: DAY_0,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt: DAY_0,
    updatedAt: DAY_0,
    ...overrides,
    id: overrides.id as StoredObjectId,
  };
}

function fixture({ days, rows }: { days: number; rows: StoredObjectRecord[] }) {
  const ownerLinks = MemoryStoredObjectOwnerLinkRepository.create();
  const records = MemoryStoredObjectRecordRepository.create(rows, ownerLinks);
  const clock = { now: dayOf(10) };
  const backfill = StoredObjectOwnerLinkBackfillService.create({
    records,
    ownerLinks,
    pageSize: 2,
    now: () => clock.now,
  });
  const migration = {
    linkProject: () =>
      backfill.linkUnowned({ projectId: PROJECT, purpose: "trace_content", retentionDays: days }),
  };
  const sweeper = StoredObjectRetentionService.create({
    records,
    ownerLinks,
    cleanup: { removeBytesOf: async () => true },
    now: () => clock.now,
  });
  const linksOf = async (id: string) =>
    (
      await ownerLinks.findExpired({ tenantId: PROJECT, before: dayOf(100_000), limit: 100 })
    ).filter((link) => link.objectId === id);
  const countOf = (id: string) =>
    ownerLinks.countAll({ tenantId: PROJECT, objectId: id as StoredObjectId });

  return { migration, sweeper, records, ownerLinks, clock, linksOf, countOf };
}

describe("given trace media stored before owner links in a project that keeps traces for 30 days", () => {
  const rows = () => [
    record({ id: "so_old", createdAt: dayOf(0) }),
    record({ id: "so_recent", createdAt: dayOf(8) }),
    record({ id: "so_third", createdAt: dayOf(9) }),
    record({ id: "so_deleted", status: "deleted", deletedAt: dayOf(5) }),
    record({ id: "so_scenario", purpose: "scenario_event", ownerKind: "scenario_event" }),
  ];

  describe("when the backfill step runs for the project", () => {
    /** @scenario "Trace media stored before owner links is linked to the trace that stored it" */
    it("links each available trace object to its owner until 30 days after its creation", async () => {
      const { migration, linksOf, countOf } = fixture({ days: 30, rows: rows() });

      const outcome = await migration.linkProject();

      expect(outcome).toEqual({ scanned: 3, linked: 3 });
      expect(await linksOf("so_old")).toEqual([
        expect.objectContaining({
          ownerKind: "trace",
          ownerId: "trace-of-so_old",
          retainUntil: dayOf(30),
          createdAt: dayOf(0),
        }),
      ]);
      expect((await linksOf("so_recent"))[0]?.retainUntil).toEqual(dayOf(38));
      expect(await countOf("so_deleted")).toBe(0);
      expect(await countOf("so_scenario")).toBe(0);
    });

    /** @scenario "Trace media stored before owner links is linked to the trace that stored it" */
    it("lets the sweep delete an object once its trace's retention has passed", async () => {
      const { migration, sweeper, records, clock } = fixture({ days: 30, rows: rows() });
      await migration.linkProject();

      clock.now = dayOf(31);
      await sweeper.sweep();

      const old = await records.findById({ tenantId: PROJECT, id: "so_old" as StoredObjectId });
      const recent = await records.findById({
        tenantId: PROJECT,
        id: "so_recent" as StoredObjectId,
      });
      expect(old?.status).toBe("deleted");
      expect(recent?.status).toBe("available");
    });

    /** @scenario "Trace media stored before owner links is linked to the trace that stored it" */
    it("links nothing on a second run", async () => {
      const { migration } = fixture({ days: 30, rows: rows() });
      await migration.linkProject();

      const second = await migration.linkProject();

      expect(second).toEqual({ scanned: 3, linked: 0 });
    });
  });

  describe("when an object already holds a link", () => {
    /** @scenario "Trace media stored before owner links is linked to the trace that stored it" */
    it("leaves that link as it is", async () => {
      const { migration, ownerLinks, linksOf } = fixture({ days: 30, rows: rows() });
      await ownerLinks.raise({
        tenantId: PROJECT,
        objectId: "so_old" as StoredObjectId,
        ownerKind: "trace",
        ownerId: "newer-trace",
        retainUntil: dayOf(90),
        createdAt: dayOf(60),
        updatedAt: dayOf(60),
      });

      await migration.linkProject();

      expect(await linksOf("so_old")).toEqual([
        expect.objectContaining({ ownerId: "newer-trace", retainUntil: dayOf(90) }),
      ]);
    });
  });
});

describe("given a purpose that follows no retention category", () => {
  it("refuses to link its objects", async () => {
    const backfill = StoredObjectOwnerLinkBackfillService.create({
      records: MemoryStoredObjectRecordRepository.create(),
      ownerLinks: MemoryStoredObjectOwnerLinkRepository.create(),
    });

    await expect(
      backfill.linkUnowned({ projectId: PROJECT, purpose: "scenario_event", retentionDays: 30 }),
    ).rejects.toThrow("follows no retention category");
  });
});

describe("given trace media stored before owner links in a project that keeps traces forever", () => {
  describe("when the backfill step runs for the project", () => {
    /** @scenario "Trace media stored before owner links is linked to the trace that stored it" */
    it("links its objects with no end", async () => {
      const { migration, sweeper, records, clock, countOf } = fixture({
        days: 0,
        rows: [record({ id: "so_forever" })],
      });

      await migration.linkProject();
      clock.now = dayOf(10_000);
      await sweeper.sweep();

      expect(await countOf("so_forever")).toBe(1);
      const kept = await records.findById({
        tenantId: PROJECT,
        id: "so_forever" as StoredObjectId,
      });
      expect(kept?.status).toBe("available");
    });
  });
});
