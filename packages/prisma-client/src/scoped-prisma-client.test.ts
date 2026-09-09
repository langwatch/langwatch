import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./generated/client.ts";
import {
  scopedPrismaClient,
  type PrismaRelationException,
  type PrismaTableModel,
} from "./ownership.ts";

function clientFixture() {
  const auditLogCreate = vi.fn(async () => ({ id: "audit_1" }));
  const userFindMany = vi.fn(async () => []);
  const userUpdate = vi.fn(async () => ({ id: "user_1" }));
  const userDelete = vi.fn(async () => ({ id: "user_1" }));
  const userFindUnique = vi.fn(() => Object.assign(Promise.resolve({ id: "user_1" }), {
    accounts: vi.fn(),
  }));
  const organizationFindMany = vi.fn(async () => []);
  const transaction = vi.fn(async (callback: (client: PrismaClient) => Promise<unknown>) => {
    return callback(client);
  });
  const client = {
    auditLog: { create: auditLogCreate },
    user: { delete: userDelete, findMany: userFindMany, findUnique: userFindUnique, update: userUpdate },
    organization: { findMany: organizationFindMany },
    $transaction: transaction,
  } as PrismaClient;

  return {
    auditLogCreate,
    client,
    organizationFindMany,
    transaction,
    userDelete,
    userFindMany,
    userUpdate,
  };
}

describe("scoped Prisma repository capability", () => {
  it("only exposes delegates for claimed models", () => {
    const { client } = clientFixture();
    const scoped = scopedPrismaClient(client, ["AuditLog"]);

    expect(() => Reflect.get(scoped, "user")).toThrow(/denied access to client member user/);
    expect(() => Reflect.get(scoped, "$queryRaw")).toThrow(/denied access to client member \$queryRaw/);
    expect(() => Reflect.get(scoped, "$extends")).toThrow(/denied access to client member \$extends/);
  });

  it("rejects foreign nested relation reads before the delegate executes", () => {
    const { client, userFindMany } = clientFixture();
    const scoped = scopedPrismaClient(client, ["User"]);

    expect(() => scoped.user.findMany({ include: { orgMemberships: true } })).toThrow(
      /foreign relation User.orgMemberships/,
    );
    expect(() => scoped.user.findMany({ select: { orgMemberships: true } })).toThrow(
      /foreign relation User.orgMemberships/,
    );
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("rejects foreign relation filters and nested writes before the delegate executes", () => {
    const { client, userFindMany, userUpdate } = clientFixture();
    const scoped = scopedPrismaClient(client, ["User"]);

    expect(() => scoped.user.findMany({ where: { orgMemberships: { some: {} } } })).toThrow(
      /foreign relation User.orgMemberships/,
    );
    expect(() =>
      scoped.user.update({
        where: { id: "user_1" },
        data: { orgMemberships: { deleteMany: {} } },
      }),
    ).toThrow(
      /foreign relation User.orgMemberships/,
    );
    expect(userFindMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("keeps an interactive transaction inside the same capability", async () => {
    const { auditLogCreate, client, transaction } = clientFixture();
    const scoped = scopedPrismaClient(client, ["AuditLog"]);

    await scoped.transaction(async (inside) => {
      await inside.auditLog.create({ data: { action: "recorded" } });
      expect(() => Reflect.get(inside, "user")).toThrow(/denied access to client member user/);
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(auditLogCreate).toHaveBeenCalledOnce();
  });

  it("does not leak Prisma fluent relation methods from a delegate result", () => {
    const { client } = clientFixture();
    const scoped = scopedPrismaClient(client, ["User"]);

    const result = scoped.user.findUnique({ where: { id: "user_1" } });

    expect(Reflect.get(result, "accounts")).toBeUndefined();
  });

  it("rejects mutations because relationMode cascades cannot be scoped", () => {
    const { client, userDelete } = clientFixture();
    const scoped = scopedPrismaClient(client, ["User"]);

    expect(() => scoped.user.delete({ where: { id: "user_1" } })).toThrow(/relationMode cascades/);
    expect(userDelete).not.toHaveBeenCalled();
  });

  it("does not inspect keys inside a scalar JSON field as relations", () => {
    const { client, organizationFindMany } = clientFixture();
    const scoped = scopedPrismaClient(client, ["Organization"]);

    expect(() =>
      scoped.organization.findMany({
        where: { signupData: { orgMemberships: { arbitrary: "JSON" } } },
      }),
    ).not.toThrow();
    expect(organizationFindMany).toHaveBeenCalledOnce();
  });

  it("snapshots claims and exceptions before returning the capability", () => {
    const { client } = clientFixture();
    const models: PrismaTableModel[] = ["User"];
    const relationExceptions: PrismaRelationException[] = [];
    const scoped = scopedPrismaClient(client, models, { relationExceptions });

    models.push("OrganizationUser");
    relationExceptions.push({
      model: "User",
      relation: "orgMemberships",
      operation: "findMany",
      reason: "Injected after construction.",
      removalCondition: "Never.",
    });

    expect(() => scoped.user.findMany({ include: { orgMemberships: true } })).toThrow(
      /foreign relation User.orgMemberships/,
    );
  });

  it("rejects incomplete and mutating relation exceptions", () => {
    const { client } = clientFixture();

    expect(() =>
      scopedPrismaClient(client, ["User"], {
        relationExceptions: [
          {
            model: "User",
            relation: "orgMemberships",
            operation: "update",
            reason: "",
            removalCondition: "",
          },
        ],
      }),
    ).toThrow(/reason, and removal condition/);
  });

  it("allows only an exact reviewed relation exception", () => {
    const { client, userFindMany, userUpdate } = clientFixture();
    const scoped = scopedPrismaClient(client, ["User"], {
      relationExceptions: [
        {
          model: "User",
          relation: "orgMemberships",
          operation: "findMany",
          reason: "Temporary migration read.",
          removalCondition: "Organization membership moves behind its API.",
        },
      ],
    });

    expect(() => scoped.user.findMany({ include: { orgMemberships: true } })).not.toThrow();
    expect(() => scoped.user.findMany({ where: { orgMemberships: { some: {} } } })).not.toThrow();
    expect(() =>
      scoped.user.update({
        where: { id: "user_1" },
        data: { orgMemberships: { deleteMany: {} } },
      }),
    ).toThrow(/foreign relation User.orgMemberships/);
    expect(userFindMany).toHaveBeenCalledTimes(2);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
