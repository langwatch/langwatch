import {
  emptySsoConnection,
  type SsoConnectionLifecycleState,
} from "@langwatch/identity";
import { SsoBreakGlassService } from "@langwatch/identity-server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing";
import { PrismaSsoBreakGlassRepository } from "../sso-break-glass.prisma.repository";
import { PrismaSsoConnectionProjectionRepository } from "../sso-connection-projection.prisma.repository";

const RUN = `${Date.now()}`;
const ORG = `org_break_glass_${RUN}`;
const OTHER_ORG = `org_break_glass_other_${RUN}`;
const T0 = 1_756_000_000_000;
const FIRST = `ssobg_a_${RUN}`;
const SECOND = `ssobg_b_${RUN}`;
const FOREIGN = `ssobg_foreign_${RUN}`;
const CONNECTION = `ssoc_recovery_${RUN}`;
const COMMAND = `cmd_activate_${RUN}`;
const ids = [FIRST, SECOND, FOREIGN];

const service = () =>
  new SsoBreakGlassService({
    bindings: new PrismaSsoBreakGlassRepository(prisma),
    notifier: { warn: async () => void 0 },
    newBindingId: () => `unused_${RUN}`,
    holderIsEligible: async () => true,
    now: () => T0,
  });

async function seed(id: string, organizationId = ORG, ended = false) {
  await prisma.ssoBreakGlassBinding.create({
    data: {
      id,
      organizationId,
      userId: `user_${id}`,
      grantedByUserId: "user_admin",
      grantedAt: new Date(T0 - 1_000),
      expiresAt: new Date(T0 + 60_000),
      supersededAt: ended ? new Date(T0 - 500) : null,
      renewedFromId: null,
      warnedDays: [],
    },
  });
}

afterAll(async () => {
  await clearReservations();
  await prisma.ssoConnection.deleteMany({ where: { organizationId: ORG } });
  await prisma.ssoBreakGlassBinding.deleteMany({ where: { id: { in: ids } } });
});

beforeEach(async () => {
  await clearReservations();
  await prisma.ssoConnection.deleteMany({ where: { organizationId: ORG } });
  await prisma.ssoBreakGlassBinding.deleteMany({ where: { id: { in: ids } } });
});

describe("atomic break-glass revocation", () => {
  it("protects a pending activation while allowing only one concurrent revocation", async () => {
    await seed(FIRST);
    await seed(SECOND);
    expect(
      await new PrismaSsoBreakGlassRepository(prisma).reserveActivationRecovery(
        {
          organizationId: ORG,
          connectionId: CONNECTION,
          commandId: COMMAND,
          nowMs: T0,
        },
      ),
    ).toBe(true);

    const attempts = await Promise.allSettled([
      service().revoke({ bindingId: FIRST, organizationId: ORG }),
      service().revoke({ bindingId: SECOND, organizationId: ORG }),
    ]);

    expect(
      attempts.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter(
        (attempt) =>
          attempt.status === "rejected" &&
          attempt.reason?.code === "sso_break_glass_last_way_in",
      ),
    ).toHaveLength(1);
    expect(
      await prisma.ssoBreakGlassBinding.count({
        where: {
          organizationId: ORG,
          supersededAt: null,
          expiresAt: { gt: new Date(T0) },
        },
      }),
    ).toBe(1);
  });

  it("blocks activation when revocation wins the organization lock first", async () => {
    await seed(FIRST);
    await service().revoke({ bindingId: FIRST, organizationId: ORG });

    await expect(
      new PrismaSsoBreakGlassRepository(prisma).reserveActivationRecovery({
        organizationId: ORG,
        connectionId: CONNECTION,
        commandId: COMMAND,
        nowMs: T0,
      }),
    ).resolves.toBe(false);
    expect(await reservationCount()).toBe(0);
  });

  it("keeps a reservation durable and idempotent across repository instances", async () => {
    await seed(FIRST);
    const firstRepository = new PrismaSsoBreakGlassRepository(prisma);
    const restartedRepository = new PrismaSsoBreakGlassRepository(prisma);

    await expect(
      firstRepository.reserveActivationRecovery({
        organizationId: ORG,
        connectionId: CONNECTION,
        commandId: COMMAND,
        nowMs: T0,
      }),
    ).resolves.toBe(true);
    await expect(
      restartedRepository.reserveActivationRecovery({
        organizationId: ORG,
        connectionId: CONNECTION,
        commandId: COMMAND,
        nowMs: T0 + 1_000,
      }),
    ).resolves.toBe(true);

    expect(await reservationCount()).toBe(1);
    await expect(
      service().revoke({ bindingId: FIRST, organizationId: ORG }),
    ).rejects.toMatchObject({ code: "sso_break_glass_last_way_in" });
  });

  it("rechecks live recovery when retrying an existing reservation", async () => {
    await seed(FIRST);
    const repository = new PrismaSsoBreakGlassRepository(prisma);
    const attempt = {
      organizationId: ORG,
      connectionId: CONNECTION,
      commandId: COMMAND,
    };
    await expect(
      repository.reserveActivationRecovery({ ...attempt, nowMs: T0 }),
    ).resolves.toBe(true);

    await expect(
      repository.reserveActivationRecovery({
        ...attempt,
        nowMs: T0 + 60_001,
      }),
    ).resolves.toBe(false);
    expect(await reservationCount()).toBe(1);
  });

  it.each([
    "DISCARDED",
    "TORN_DOWN",
  ] as const)("cancels the durable reservation when projection lands %s", async (state) => {
    await seed(FIRST);
    const connectionId = `${CONNECTION}_${state.toLowerCase()}`;
    const commandId = `${COMMAND}_${state.toLowerCase()}`;
    const repository = new PrismaSsoBreakGlassRepository(prisma);
    await repository.reserveActivationRecovery({
      organizationId: ORG,
      connectionId,
      commandId,
      nowMs: T0,
    });

    await projectConnection({ connectionId, state });

    expect(await reservationCount()).toBe(0);
  });

  it("atomically consumes the exact reservation with the ACTIVE projection", async () => {
    await seed(FIRST);
    const repository = new PrismaSsoBreakGlassRepository(prisma);
    await repository.reserveActivationRecovery({
      organizationId: ORG,
      connectionId: CONNECTION,
      commandId: COMMAND,
      nowMs: T0,
    });

    await projectConnection({
      connectionId: CONNECTION,
      state: "ACTIVE",
      activationCommandId: COMMAND,
    });

    expect(await reservationCount()).toBe(0);
    expect(
      await prisma.ssoConnection.findUniqueOrThrow({
        where: { id: CONNECTION },
        select: { state: true },
      }),
    ).toEqual({ state: "ACTIVE" });
  });

  it("does not mutate a binding through another organization", async () => {
    await seed(FOREIGN, OTHER_ORG);

    await expect(
      service().revoke({ bindingId: FOREIGN, organizationId: ORG }),
    ).rejects.toThrow(/not one of organization/);
    expect(
      await prisma.ssoBreakGlassBinding.findUnique({ where: { id: FOREIGN } }),
    ).toMatchObject({
      supersededAt: null,
    });
  });

  it("returns an already-ended binding without rewriting it", async () => {
    await seed(FIRST, ORG, true);
    const ended = await service().revoke({
      bindingId: FIRST,
      organizationId: ORG,
    });

    expect(ended.supersededAtMs).toBe(T0 - 500);
  });
});

async function clearReservations(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "SsoActivationRecoveryReservation"
    WHERE "organizationId" IN (${ORG}, ${OTHER_ORG})
  `;
}

async function reservationCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "SsoActivationRecoveryReservation"
    WHERE "organizationId" = ${ORG}
  `;
  return Number(rows[0]?.count ?? 0n);
}

async function projectConnection({
  connectionId,
  state,
  activationCommandId,
}: {
  connectionId: string;
  state: SsoConnectionLifecycleState;
  activationCommandId?: string;
}): Promise<void> {
  const projection = new PrismaSsoConnectionProjectionRepository(prisma);
  await projection.store(
    {
      state: {
        ...emptySsoConnection({ connectionId }),
        organizationId: ORG,
        state,
        createdAtMs: T0,
        updatedAtMs: T0,
        CreatedAt: T0,
        UpdatedAt: T0,
        LastEventOccurredAt: T0,
        ActivationReservationCommandIds:
          activationCommandId === undefined ? [] : [activationCommandId],
      },
      cursor: { acceptedAt: T0, eventId: `${connectionId}-event` },
      occurredAt: T0,
      createdAt: T0,
      updatedAt: T0,
      version: "activation-recovery-test",
    },
    { aggregateId: connectionId, tenantId: createTenantId(ORG) },
  );
}
