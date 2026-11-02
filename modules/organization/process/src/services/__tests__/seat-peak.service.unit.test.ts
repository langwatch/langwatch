import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import {
  type OrganizationIdPageInput,
  OrganizationUserRole,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  RecordSeatChangedCommandData,
  RecordSeatSnapshotCommandData,
} from "../../eventing/seat-peak.events.ts";
import { MemoryOrganizationSeatPeakRepository } from "../../repositories/memory/memory.organization-seat-peak.repository.ts";
import { MemoryOrganizationSeatRepository } from "../../repositories/memory/memory.organization-seat.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { emptySeatPeak, foldSeatPeak, type SeatPeakFact } from "../../rules/seat-peak.rules.ts";
import { SeatPeakService } from "../seat-peak.service.ts";

const ORG = "org-new";
const CREATED_AT = Temporal.Instant.from("2026-11-02T10:00:00Z");

const plan: Plan = {
  planSource: "free",
  type: "free",
  name: "Free",
  free: true,
  maxMembers: 50,
  maxMembersLite: 10,
  maxMessagesPerMonth: 1_000_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

/** Collects what the service sends, as the registered pipeline would receive it. */
function recordingSenders() {
  const snapshots: RecordSeatSnapshotCommandData[] = [];
  const changes: RecordSeatChangedCommandData[] = [];
  return {
    snapshots,
    senders: {
      recordSeatSnapshot: {
        send: async (data: RecordSeatSnapshotCommandData) => void snapshots.push(data),
        sendBatch: async (data: RecordSeatSnapshotCommandData[]) => void snapshots.push(...data),
      },
      recordSeatChanged: {
        send: async (data: RecordSeatChangedCommandData) => void changes.push(data),
        sendBatch: async (data: RecordSeatChangedCommandData[]) => void changes.push(...data),
      },
    },
  };
}

function setup({ organizationIds = [ORG] }: { organizationIds?: string[] } = {}) {
  const memory = MemoryOrganizationDatabase.create();
  memory.organizationUsers.push({
    userId: "founder",
    organizationId: ORG,
    role: OrganizationUserRole.ADMIN,
    disabledAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
  const peaks = MemoryOrganizationSeatPeakRepository.create();
  const service = SeatPeakService.create({
    seats: MemoryOrganizationSeatRepository.create({ memory }),
    peaks,
    organizations: {
      listAllIds: async ({ after }: OrganizationIdPageInput = {}) => ({
        ids: organizationIds.filter((id) => after === undefined || id > after),
        next: null,
      }),
    },
    plans: createApiFixture<EntitlementApi>({ getActivePlan: async () => plan }, "EntitlementApi"),
  });
  const sent = recordingSenders();
  service.connect(sent.senders);
  return { service, peaks, snapshots: sent.snapshots };
}

/** What the projection stores after folding the facts, as the worker would. */
async function storeFolded({
  peaks,
  facts,
}: {
  peaks: MemoryOrganizationSeatPeakRepository;
  facts: SeatPeakFact[];
}) {
  const state = facts.reduce(
    (folded, fact) => foldSeatPeak({ state: folded, fact }),
    emptySeatPeak(),
  );
  const at = CREATED_AT.epochMilliseconds;
  await peaks.store(
    {
      state: { ...state, CreatedAt: at, UpdatedAt: at, LastEventOccurredAt: at },
      cursor: { acceptedAt: at, eventId: "event-1" },
      occurredAt: at,
      createdAt: at,
      updatedAt: at,
      version: "2026-11-02",
    },
    { tenantId: ORG, aggregateId: ORG } as never,
  );
}

const founderJoined: SeatPeakFact = {
  type: "seat_changed",
  data: {
    tenantId: ORG,
    organizationId: ORG,
    holder: { kind: "member", userId: "founder" },
    from: "none",
    to: "full",
    cause: "organization_created",
    actorUserId: "founder",
    occurredAt: CREATED_AT.epochMilliseconds,
    changeId: "change-founder",
  },
};

describe("SeatPeakService", () => {
  describe("when an organization is created with its first admin", () => {
    /** @scenario "A new organization starts counting from its first admin" */
    it("opens the count with the admin's full seat, whichever of the two is folded first", async () => {
      const { service, peaks, snapshots } = setup();

      await service.open({ organizationId: ORG, occurredAt: CREATED_AT.epochMilliseconds });
      const [opening] = snapshots;
      if (!opening) throw new Error("no opening snapshot was recorded");
      expect(opening.holders).toEqual([
        { holder: { kind: "member", userId: "founder" }, seat: "full" },
      ]);

      const openingFact: SeatPeakFact = { type: "seat_snapshot_taken", data: opening };
      for (const facts of [
        [openingFact, founderJoined],
        [founderJoined, openingFact],
      ]) {
        await storeFolded({ peaks, facts });
        const read = await service.read({ organizationId: ORG, now: CREATED_AT.epochMilliseconds });
        expect(read).toMatchObject({
          counted: true,
          seats: { full: 1, lite: 0, developer: 0 },
          caps: { fullSeats: 50, liteSeats: 10 },
          months: [{ month: "2026-11", fullPeak: 1 }],
          mismatches: 0,
        });
      }
    });
  });

  describe("given the organization's count has not opened", () => {
    it("answers not counted, with the licence's caps and no peak", async () => {
      const { service } = setup();

      await expect(
        service.read({ organizationId: ORG, now: CREATED_AT.epochMilliseconds }),
      ).resolves.toEqual({ counted: false, caps: { fullSeats: 50, liteSeats: 10 } });
    });
  });

  describe("when the opening snapshot step runs", () => {
    it("opens every organization not yet counted, and none twice", async () => {
      const { service, peaks, snapshots } = setup({ organizationIds: [ORG, "org-other"] });
      await storeFolded({
        peaks,
        facts: [
          {
            type: "seat_snapshot_taken",
            data: { tenantId: ORG, organizationId: ORG, holders: [], occurredAt: 1 },
          },
        ],
      });

      const page = await service.openPage({
        afterOrganizationId: null,
        limit: 100,
        dryRun: false,
        occurredAt: CREATED_AT.epochMilliseconds,
      });

      expect(page).toEqual({ lastOrganizationId: "org-other", organizations: 2, opened: 1 });
      expect(snapshots.map((snapshot) => snapshot.organizationId)).toEqual(["org-other"]);
    });

    it("records nothing on a dry run", async () => {
      const { service, snapshots } = setup();

      const page = await service.openPage({
        afterOrganizationId: null,
        limit: 100,
        dryRun: true,
        occurredAt: CREATED_AT.epochMilliseconds,
      });

      expect(page.opened).toBe(0);
      expect(snapshots).toEqual([]);
    });
  });
});
