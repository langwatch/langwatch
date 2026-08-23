import { IdentityPrimaryMustDemoteFirstError } from "@langwatch/identity";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { describe, expect, it, vi } from "vitest";
import { createIdentityDatabase } from "../better-auth/adapter";
import { findAllRows } from "../better-auth/context";
import {
  IdentityAdapterUnroutedWriteError,
  ROUTED_MODELS,
  routeWrite,
  WRITE_OPERATIONS,
} from "../better-auth/routing";

const USER = "user_sam";

/**
 * A recording Prisma-shaped client the stock prismaAdapter row engine runs
 * against. Empty better-auth options mean canonical model names map to
 * themselves, so the stub's keys are the canonical names — the facade's
 * behavior is under test here, not the stock adapter's field mapping. No
 * Prisma type is involved: the engine only ever calls methods on it.
 */
function prismaStub(options?: {
  onCall?: (call: { model: string; method: string }) => void;
}) {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const modelDelegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => {
          return async (args: unknown) => {
            calls.push({ model, method, args });
            options?.onCall?.({ model, method });
            if (method === "create") {
              const data = (args as { data: Record<string, unknown> }).data;
              return { id: data.id ?? "row_1", ...data };
            }
            if (method === "findFirst") {
              if (model === "user") return { id: USER, email: "sam@acme.com" };
              return null;
            }
            if (method === "findMany") {
              if (model === "user") return [{ id: USER, email: "sam@acme.com" }];
              if (model === "account") {
                return [{ id: "acc_1", userId: USER, providerId: "google", accountId: "gid_1" }];
              }
              return [];
            }
            if (method === "update") return { id: USER };
            if (method === "count") return 0;
            if (method === "deleteMany" || method === "updateMany") return { count: 1 };
            return null;
          };
        },
      },
    );
  const client = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === "$transaction") {
          return async (fn: (trx: unknown) => Promise<unknown>) => fn(client);
        }
        if (prop === "then") return undefined;
        return modelDelegate(prop);
      },
    },
  );
  return { client, calls };
}

function portsStub(options?: { identifierForAccount?: string | null }) {
  return {
    heads: {
      findIdentifierIdForAccount: vi
        .fn()
        .mockResolvedValue(
          options?.identifierForAccount === undefined ? "idf_1" : options.identifierForAccount,
        ),
    },
    users: { storeUserHashKeyIfMissing: vi.fn().mockResolvedValue(undefined) },
    identity: {
      attachIdentifier: vi.fn().mockResolvedValue([]),
      detachIdentifier: vi.fn().mockResolvedValue([]),
      eraseUser: vi.fn().mockResolvedValue([]),
    },
  };
}

function adapterOver(
  client: unknown,
  ports: ReturnType<typeof portsStub>,
  options?: { latched?: (args: { userId: string }) => Promise<boolean>; now?: () => number },
) {
  return createIdentityDatabase({
    base: prismaAdapter(client as never, { provider: "postgresql" }),
    ...ports,
    isLatched: options?.latched ?? (async () => false),
    ...(options?.now ? { now: options.now } : {}),
  })({});
}

describe("identity adapter routing table", () => {
  describe("when the routed surface is enumerated", () => {
    it("classifies every model and write operation explicitly", () => {
      for (const model of ROUTED_MODELS) {
        for (const operation of WRITE_OPERATIONS) {
          expect(() => routeWrite(model, operation)).not.toThrow();
        }
      }
      expect([...ROUTED_MODELS].sort()).toEqual([
        "account",
        "ratelimit",
        "session",
        "user",
        "verification",
      ]);
    });
  });

  describe("when better-auth writes to a model nobody classified", () => {
    /** @scenario "An unrouted better-auth write is refused and named" */
    it("refuses the write naming the model and operation", async () => {
      const { client } = prismaStub();
      const adapter = adapterOver(client, portsStub());
      await expect(
        adapter.create({ model: "twoFactor", data: { userId: USER } }),
      ).rejects.toBeInstanceOf(IdentityAdapterUnroutedWriteError);
      expect(() => routeWrite("twoFactor", "delete")).toThrow(/twoFactor.*delete/);
    });
  });
});

describe("findAllRows", () => {
  describe("when the predicate matches more rows than one adapter page", () => {
    it("pages until the selection is complete, in a stable order", async () => {
      const rows = Array.from({ length: 250 }, (_, index) => ({
        id: `row_${String(index).padStart(3, "0")}`,
      }));
      const findMany = vi.fn(
        async ({ limit, offset }: { limit: number; offset: number }) =>
          rows.slice(offset, offset + limit),
      );

      const all = await findAllRows<{ id: string }>({ findMany } as never, {
        model: "user",
        where: [],
      });

      expect(all).toHaveLength(250);
      expect(all[0]?.id).toBe("row_000");
      expect(all[249]?.id).toBe("row_249");
      expect(findMany).toHaveBeenCalledTimes(3);
      for (const [index, offset] of [0, 100, 200].entries()) {
        expect(findMany).toHaveBeenNthCalledWith(
          index + 1,
          expect.objectContaining({
            limit: 100,
            offset,
            sortBy: { field: "id", direction: "asc" },
          }),
        );
      }
    });
  });
});

describe("identity adapter write gate", () => {
  describe("when no user is latched", () => {
    /** @scenario "The adapter's write gate ships closed for every user" */
    it("writes protocol rows exactly as the stock adapter would and runs no ceremony", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub();
      const adapter = adapterOver(client, ports);

      await adapter.create({
        model: "account",
        data: { userId: USER, providerId: "google", accountId: "gid_1" },
      });
      await adapter.create({ model: "session", data: { userId: USER, token: "tok" } });

      expect(ports.identity.attachIdentifier).not.toHaveBeenCalled();
      expect(calls.filter((c) => c.method === "create").map((c) => c.model)).toEqual([
        "account",
        "session",
      ]);
    });
  });

  describe("when the user's backfill has latched", () => {
    /** @scenario "A latched user's domain-significant writes produce events structurally" */
    it("runs the attach ceremony before the Account row exists", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub();
      const order: string[] = [];
      ports.identity.attachIdentifier.mockImplementation(async () => {
        order.push("ceremony");
        return [];
      });
      const adapter = adapterOver(client, ports, {
        latched: async ({ userId }) => userId === USER,
        now: () => 1_690_000_000_000,
      });

      await adapter.create({
        model: "account",
        data: { userId: USER, providerId: "google", accountId: "gid_1" },
      });
      order.push(
        ...calls.filter((c) => c.model === "account" && c.method === "create").map(() => "row"),
      );

      expect(order).toEqual(["ceremony", "row"]);
      expect(ports.identity.attachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          tenantId: USER,
          provider: "google",
          providerAccountId: "gid_1",
          value: "sam@acme.com",
          occurredAtMs: 1_690_000_000_000,
        }),
      );
    });

    /** @scenario "Identifier ids are deterministic so backfill and live emission converge" */
    it("derives the attach from the row's own id and createdAt, and writes the row with that id", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub();
      const createdAt = new Date(1_690_000_123_000);
      const adapter = adapterOver(client, ports, {
        latched: async () => true,
        now: () => 1_700_000_000_000,
      });

      await adapter.create({
        model: "account",
        data: { userId: USER, providerId: "google", accountId: "gid_1", createdAt },
      });

      const attach = ports.identity.attachIdentifier.mock.calls[0]?.[0] as {
        accountId: string | null;
        occurredAtMs: number;
      };
      expect(attach.occurredAtMs).toBe(createdAt.getTime());
      expect(attach.accountId).toMatch(/^[\w-]{21}$/);
      const rowWrite = calls.find((c) => c.model === "account" && c.method === "create")
        ?.args as { data: { id: string } };
      expect(rowWrite.data.id).toBe(attach.accountId);
    });

    it("detaches the identifier mirroring a deleted Account row", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub({ identifierForAccount: "idf_google" });
      const adapter = adapterOver(client, ports, {
        latched: async () => true,
        now: () => 1_700_000_000_000,
      });

      await adapter.delete({ model: "account", where: [{ field: "id", value: "acc_1" }] });

      expect(ports.heads.findIdentifierIdForAccount).toHaveBeenCalledWith({
        userId: USER,
        accountId: "acc_1",
        provider: "google",
      });
      expect(ports.identity.detachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          identifierId: "idf_google",
          occurredAtMs: 1_700_000_000_000,
        }),
      );
      expect(calls.some((c) => c.model === "account" && c.method === "delete")).toBe(true);
    });

    it("deleteMany detaches one identifier per row, then deletes", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub({ identifierForAccount: "idf_google" });
      const adapter = adapterOver(client, ports, { latched: async () => true });

      await adapter.deleteMany({ model: "account", where: [{ field: "userId", value: USER }] });

      expect(ports.identity.detachIdentifier).toHaveBeenCalledTimes(1);
      expect(calls.some((c) => c.model === "account" && c.method === "deleteMany")).toBe(true);
    });

    it("a row no single identifier mirrors is logged and skipped; the protocol delete still happens", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub({ identifierForAccount: null });
      const adapter = adapterOver(client, ports, { latched: async () => true });

      await adapter.delete({ model: "account", where: [{ field: "id", value: "acc_1" }] });

      expect(ports.identity.detachIdentifier).not.toHaveBeenCalled();
      expect(calls.some((c) => c.model === "account" && c.method === "delete")).toBe(true);
    });

    it("a domain write inside a transaction is routed but runs no ceremony", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub();
      const adapter = adapterOver(client, ports, { latched: async () => true });

      await adapter.transaction(async (trx) => {
        await trx.create({
          model: "account",
          data: { userId: USER, providerId: "google", accountId: "gid_1" },
        });
        expect(() => trx.create({ model: "unrouted-model", data: {} })).toThrow(
          IdentityAdapterUnroutedWriteError,
        );
      });

      expect(ports.identity.attachIdentifier).not.toHaveBeenCalled();
      expect(calls.some((c) => c.model === "account" && c.method === "create")).toBe(true);
    });

    it("a vetoed ceremony refuses the protocol write too", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub();
      ports.identity.detachIdentifier.mockRejectedValue(
        new IdentityPrimaryMustDemoteFirstError("refused"),
      );
      const adapter = adapterOver(client, ports, { latched: async () => true });

      await expect(
        adapter.delete({ model: "account", where: [{ field: "id", value: "acc_1" }] }),
      ).rejects.toMatchObject({ code: "identity_primary_must_demote_first" });
      expect(calls.some((c) => c.model === "account" && c.method === "delete")).toBe(false);
    });
  });

  describe("when better-auth deletes a user", () => {
    /** @scenario "Deleting a latched user runs the erase ceremony before the row delete" */
    it("runs the erase ceremony for a latched user before the row delete", async () => {
      const order: string[] = [];
      const { client } = prismaStub({
        onCall: (call) => {
          if (call.model === "user" && call.method === "delete") order.push("row");
        },
      });
      const ports = portsStub();
      ports.identity.eraseUser.mockImplementation(async () => {
        order.push("ceremony");
        return [];
      });
      const adapter = adapterOver(client, ports, {
        latched: async ({ userId }) => userId === USER,
        now: () => 1_700_000_000_000,
      });

      await adapter.delete({ model: "user", where: [{ field: "id", value: USER }] });

      expect(order).toEqual(["ceremony", "row"]);
      expect(ports.identity.eraseUser).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: USER,
          userId: USER,
          occurredAtMs: 1_700_000_000_000,
          actor: { type: "user", id: USER },
        }),
      );
    });

    /** @scenario "Deleting an unlatched user runs no ceremony; the erasure service reconciles" */
    it("runs no ceremony for an unlatched user; the row delete still happens", async () => {
      const { client, calls } = prismaStub();
      const ports = portsStub();
      const adapter = adapterOver(client, ports);

      await adapter.delete({ model: "user", where: [{ field: "id", value: USER }] });

      expect(ports.identity.eraseUser).not.toHaveBeenCalled();
      expect(calls.some((c) => c.model === "user" && c.method === "delete")).toBe(true);
    });
  });

  describe("when a user row is created", () => {
    it("stores a fresh userHashKey through the guarded write after the row exists", async () => {
      const { client } = prismaStub();
      const ports = portsStub();
      const adapter = adapterOver(client, ports);

      const created = (await adapter.create({
        model: "user",
        data: { email: "sam@acme.com" },
      })) as { id: string };

      expect(ports.users.storeUserHashKeyIfMissing).toHaveBeenCalledTimes(1);
      const args = ports.users.storeUserHashKeyIfMissing.mock.calls[0]?.[0] as {
        userId: string;
        userHashKey: string;
      };
      // The key is minted for the row the engine actually wrote, whatever
      // id the engine chose for it.
      expect(args.userId).toBe(created.id);
      expect(args.userHashKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it("a failed mint never fails the sign-up", async () => {
      const { client } = prismaStub();
      const ports = portsStub();
      ports.users.storeUserHashKeyIfMissing.mockRejectedValue(new Error("postgres unavailable"));
      const adapter = adapterOver(client, ports);

      await expect(
        adapter.create({ model: "user", data: { email: "sam@acme.com" } }),
      ).resolves.toMatchObject({ email: "sam@acme.com" });
    });
  });
});
