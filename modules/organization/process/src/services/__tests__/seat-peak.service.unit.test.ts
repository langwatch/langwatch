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
import type { SeatPeakFact } from "../../rules/seat-peak.rules.ts";
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
  maxMembersDeveloper: 0,
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

function setup({
  organizationIds = [ORG],
  activePlan = plan,
}: { organizationIds?: string[]; activePlan?: Plan } = {}) {
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
    plans: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => activePlan },
      "EntitlementApi",
    ),
  });
  const sent = recordingSenders();
  service.connect(sent.senders);
  return { service, snapshots: sent.snapshots };
}

/** Folds the facts one at a time through the service, as the worker's fold subscriber would. */
async function storeFolded({
  service,
  facts,
}: {
  service: SeatPeakService;
  facts: SeatPeakFact[];
}) {
  for (const fact of facts) await service.fold({ organizationId: ORG, fact });
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
      const { service, snapshots } = setup();

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
        const folded = setup().service;
        await storeFolded({ service: folded, facts });
        const read = await folded.read({ organizationId: ORG, now: CREATED_AT.epochMilliseconds });
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

  describe("given an uncapped plan", () => {
    /** @scenario "The ops console reads an unlimited licence's seats as unlimited" */
    it("answers its uncapped seats as null and a finite cap as the number", async () => {
      const { service } = setup({
        activePlan: { ...plan, maxMembers: Number.MAX_SAFE_INTEGER, maxMembersLite: 1_000_000 },
      });

      await expect(
        service.read({ organizationId: ORG, now: CREATED_AT.epochMilliseconds }),
      ).resolves.toMatchObject({ caps: { fullSeats: null, liteSeats: 1_000_000 } });
    });
  });

  describe("when the opening snapshot step runs", () => {
    it("opens every organization not yet counted, and none twice", async () => {
      const { service, snapshots } = setup({ organizationIds: [ORG, "org-other"] });
      await storeFolded({
        service,
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
