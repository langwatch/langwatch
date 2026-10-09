import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { GrantsAuthzReadRepository } from "~/server/app-layer/authz/repositories/authz-read.grants.repository";
import { prisma } from "~/server/db";
import type { AttachGrantCommandData } from "~/server/event-sourcing/pipelines/authz-grants/schemas/commands";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

const namespace = `founder-${nanoid(8)}`;
const userId = `user-${namespace}`;
const organizationIds: string[] = [];
const events = createAuthzTestEventSourcing(prisma);
const pipeline = events.getPipeline("authz_grant");
const writer = new GrantsLedgerWriter(prisma, {
  commands: async () => ({ commands: pipeline.commands }),
});

function creationInput() {
  const id = `${namespace}-${nanoid(6)}`;
  const orgId = `org-${id}`;
  organizationIds.push(orgId);
  return {
    userId,
    orgId,
    orgName: "ACME",
    orgSlug: orgId,
    teamId: `team-${id}`,
    teamSlug: `team-${id}`,
    pricingModel: "SEAT_EVENT" as const,
  };
}

beforeAll(async () => {
  await prisma.user.create({
    data: { id: userId, email: `${namespace}@example.com` },
  });
});

afterAll(async () => {
  await events.close();
  const organizationId = { in: organizationIds };
  await cleanupTestRows(prisma, [
    ["auditLog", { organizationId }],
    ["grant", { organizationId }],
    ["roleBinding", { organizationId }],
    ["teamUser", { userId }],
    ["team", { organizationId }],
    ["organizationUser", { userId, organizationId }],
    ["organization", { id: organizationId }],
    ["user", { id: userId }],
  ]);
});

describe("founder grant confirmation", () => {
  /** @scenario Founder organization is committed before grants and stays inaccessible until confirmation */
  it("keeps the committed membership disabled until the grants are confirmed", async () => {
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const waitingWriter = new GrantsLedgerWriter(prisma, {
      commands: async () => {
        reached.resolve();
        await gate.promise;
        return { commands: pipeline.commands };
      },
    });
    const input = creationInput();
    const pending = new PrismaOrganizationRepository(
      prisma,
      waitingWriter,
    ).createAndAssign(input);
    try {
      await reached.promise;
      expect(
        await prisma.organization.findUnique({ where: { id: input.orgId } }),
      ).toEqual(expect.objectContaining({ id: input.orgId }));
      expect(
        await prisma.organizationUser.findUniqueOrThrow({
          where: {
            userId_organizationId: { userId, organizationId: input.orgId },
          },
          select: { disabledAt: true },
        }),
      ).toEqual({ disabledAt: expect.any(Date) });
      expect(
        await new GrantsAuthzReadRepository(prisma).findUserBindings({
          userId,
          organizationId: input.orgId,
        }),
      ).toEqual([]);
    } finally {
      gate.resolve();
      await pending;
    }
    const result = await pending;
    expect(result.organization.id).toBe(input.orgId);
    expect(
      await new GrantsAuthzReadRepository(prisma).findUserBindings({
        userId,
        organizationId: input.orgId,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeType: "ORGANIZATION",
          scopeId: input.orgId,
        }),
        expect.objectContaining({ scopeType: "TEAM", scopeId: input.teamId }),
      ]),
    );
    expect(
      await prisma.organizationUser.findUniqueOrThrow({
        where: {
          userId_organizationId: { userId, organizationId: input.orgId },
        },
        select: { disabledAt: true },
      }),
    ).toEqual({ disabledAt: null });
  });

  it("rolls back creation when no grant can be appended", async () => {
    const unavailableWriter = new GrantsLedgerWriter(prisma, {
      commands: async () => {
        throw new Error("append unavailable");
      },
    });
    const input = creationInput();
    await expect(
      new PrismaOrganizationRepository(
        prisma,
        unavailableWriter,
      ).createAndAssign(input),
    ).rejects.toThrow("append unavailable");
    expect(
      await prisma.organization.count({ where: { id: input.orgId } }),
    ).toBe(0);
    expect(await prisma.team.count({ where: { id: input.teamId } })).toBe(0);
    expect(
      await prisma.organizationUser.count({
        where: { userId, organizationId: input.orgId },
      }),
    ).toBe(0);
  });

  it("denies orphaned grants after a lost append acknowledgement and allows a fresh signup", async () => {
    const capturedCommands: AttachGrantCommandData[] = [];
    const interruptedWriter = new GrantsLedgerWriter(prisma, {
      commands: async () => ({
        commands: {
          ...pipeline.commands,
          attachGrant: {
            send: async (command) => {
              capturedCommands.push(command);
              throw new Error("append acknowledgement lost");
            },
          },
        },
      }),
    });
    const abandoned = creationInput();
    await expect(
      new PrismaOrganizationRepository(
        prisma,
        interruptedWriter,
      ).createAndAssign(abandoned),
    ).rejects.toThrow("append acknowledgement lost");
    expect(
      await prisma.organization.count({ where: { id: abandoned.orgId } }),
    ).toBe(0);
    expect(
      await prisma.organizationUser.count({
        where: { userId, organizationId: abandoned.orgId },
      }),
    ).toBe(0);
    await Promise.all(
      capturedCommands.map((command) =>
        pipeline.commands.attachGrant.send(command),
      ),
    );
    await expect
      .poll(() =>
        prisma.grant.count({
          where: { organizationId: abandoned.orgId },
        }),
      )
      .toBe(2);
    expect(
      await new GrantsAuthzReadRepository(prisma).findUserBindings({
        userId,
        organizationId: abandoned.orgId,
      }),
    ).toEqual([]);
    expect(
      await prisma.organization.count({ where: { id: abandoned.orgId } }),
    ).toBe(0);
    const retry = creationInput();
    const result = await new PrismaOrganizationRepository(
      prisma,
      writer,
    ).createAndAssign(retry);
    expect(result.organization.id).toBe(retry.orgId);
    expect(
      await prisma.organizationUser.count({
        where: {
          userId,
          organizationId: { in: [abandoned.orgId, retry.orgId] },
        },
      }),
    ).toBe(1);
    expect(
      await new GrantsAuthzReadRepository(prisma).findUserBindings({
        userId,
        organizationId: retry.orgId,
      }),
    ).toHaveLength(2);
  });
});
