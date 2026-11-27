/**
 * Who held a seat in a window, read from Postgres members and the organization's own facts.
 * @vitest-environment node
 * @see modules/ops/specs/seat-sharing-check.feature
 */
import { EventLogReadSeat } from "@langwatch/eventing";
import { EventRepositoryMemory } from "@langwatch/eventing/testing";
import { createLogger } from "@langwatch/observability";
import {
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { EventingOrganizationDeparturesRepository } from "../../repositories/eventing/eventing.organization-departures.repository.ts";
import { PrismaOrganizationSeatRepository } from "../../repositories/prisma/prisma.organization-seat.repository.ts";
import { OrganizationSeatOccupancyService } from "../organization-seat-occupancy.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!DB_URL)("OrganizationSeatOccupancyService over Postgres", () => {
  const namespace = `seat-occupancy-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:seat-occupancy"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function person(name: string, deactivated = false) {
    const user = await prisma.user.create({
      data: {
        email: `${name}-${namespace}@test.com`,
        name,
        ...(deactivated ? { deactivatedAt: new Date() } : {}),
      },
    });
    userIds.push(user.id);
    return user.id;
  }

  function departure({
    organizationId,
    type,
    userId,
    occurredAt,
    heldFullSeat,
  }: {
    organizationId: string;
    type: string;
    userId: string;
    occurredAt: number;
    heldFullSeat?: boolean;
  }) {
    const id = `event-${nanoid(10)}`;
    return {
      TenantId: organizationId,
      AggregateType: ORGANIZATION_AGGREGATE_TYPE,
      AggregateId: organizationId,
      EventId: id,
      EventTimestamp: occurredAt,
      EventOccurredAt: occurredAt,
      EventType: type,
      EventVersion: "2026-10-08",
      EventPayload: { tenantId: organizationId, organizationId, userId, occurredAt, heldFullSeat },
      ProcessingTraceparent: "",
      IdempotencyKey: id,
    };
  }

  /** @scenario "Today's full-seat members are the people holding a full seat now" */
  it("lists the admin and the member as full seats, and the disabled member as departed", async () => {
    const now = Date.now();
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--test-${namespace}` },
    });
    organizationIds.push(organization.id);
    const organizationId = organization.id;
    const [admin, member, lite, disabled, deactivated, longGone] = await Promise.all([
      person("admin"),
      person("member"),
      person("lite"),
      person("disabled"),
      person("deactivated", true),
      person("long-gone"),
    ]);
    await prisma.organizationUser.createMany({
      data: [
        { organizationId, userId: admin, role: OrganizationUserRole.ADMIN },
        { organizationId, userId: member, role: OrganizationUserRole.MEMBER },
        { organizationId, userId: lite, role: OrganizationUserRole.EXTERNAL },
        {
          organizationId,
          userId: disabled,
          role: OrganizationUserRole.MEMBER,
          disabledAt: new Date(now - DAY_MS),
        },
        { organizationId, userId: deactivated, role: OrganizationUserRole.MEMBER },
      ],
    });
    const events = EventRepositoryMemory.createForTesting();
    await events.insertEventRecords([
      departure({
        organizationId,
        type: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
        userId: disabled,
        occurredAt: now - DAY_MS,
      }),
      departure({
        organizationId,
        type: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
        userId: longGone,
        occurredAt: now - 40 * DAY_MS,
      }),
    ]);
    const occupancy = OrganizationSeatOccupancyService.create({
      seats: PrismaOrganizationSeatRepository.create(prisma),
      departures: EventingOrganizationDeparturesRepository.create({
        eventReadSeat: EventLogReadSeat.create({ repository: events }),
      }),
    });

    const occupants = await occupancy.findSince({ organizationId, since: now - 30 * DAY_MS });

    expect(occupants.fullSeatHolderIds.toSorted()).toEqual([admin, member].toSorted());
    expect(occupants.departedIds).toEqual([disabled]);
  });

  /** @scenario "Only departures that held a full seat count, older facts count as before" */
  it("counts a departure that held a full seat or says nothing, never one that held none", async () => {
    const now = Date.now();
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--test-${namespace}-departures` },
    });
    organizationIds.push(organization.id);
    const organizationId = organization.id;
    const [full, lite, older] = await Promise.all([
      person("full-departed"),
      person("lite-departed"),
      person("older-fact"),
    ]);
    const events = EventRepositoryMemory.createForTesting();
    await events.insertEventRecords([
      departure({
        organizationId,
        type: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
        userId: full,
        occurredAt: now - DAY_MS,
        heldFullSeat: true,
      }),
      departure({
        organizationId,
        type: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
        userId: lite,
        occurredAt: now - DAY_MS,
        heldFullSeat: false,
      }),
      departure({
        organizationId,
        type: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
        userId: older,
        occurredAt: now - DAY_MS,
      }),
    ]);
    const occupancy = OrganizationSeatOccupancyService.create({
      seats: PrismaOrganizationSeatRepository.create(prisma),
      departures: EventingOrganizationDeparturesRepository.create({
        eventReadSeat: EventLogReadSeat.create({ repository: events }),
      }),
    });

    const occupants = await occupancy.findSince({ organizationId, since: now - 30 * DAY_MS });

    expect(occupants.departedIds.toSorted()).toEqual([full, older].toSorted());
  });
});
