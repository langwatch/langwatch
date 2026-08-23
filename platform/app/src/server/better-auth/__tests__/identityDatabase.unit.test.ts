import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { IdentityPrimaryMustDemoteFirstError } from "~/server/event-sourcing/pipelines/identity/commands/identityCommandErrors";
import {
  createIdentityDatabase,
  IdentityAdapterUnroutedWriteError,
  identifierProviderFor,
  ROUTED_MODELS,
  routeWrite,
  WRITE_OPERATIONS,
} from "../identityDatabase";

const USER = "user_sam";

/**
 * A recording PrismaClient stub the stock prismaAdapter row engine runs
 * against. Empty better-auth options mean canonical model names map to
 * themselves, so the stub's keys are the canonical names — the facade's
 * behavior is under test here, not the stock adapter's field mapping.
 */
function prismaStub(options?: {
  /** What `identifier.findFirst` (the by-accountId read) answers. */
  identifierByAccount?: { id: string } | null;
  /** What `identifier.findMany` (the by-provider fallback) answers. */
  identifiersByProvider?: Array<{ id: string }>;
  /** Observes every delegate call at invocation time, for ordering pins. */
  onCall?: (call: { model: string; method: string }) => void;
}) {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const identifierByAccount =
    options?.identifierByAccount === undefined
      ? { id: "idf_1" }
      : options.identifierByAccount;
  const identifiersByProvider = options?.identifiersByProvider ?? [];
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
              if (model === "identifier") return identifierByAccount;
              return null;
            }
            if (method === "findMany") {
              if (model === "identifier") return identifiersByProvider;
              if (model === "user") {
                return [{ id: USER, email: "sam@acme.com" }];
              }
              if (model === "account") {
                return [
                  {
                    id: "acc_1",
                    userId: USER,
                    providerId: "google",
                    accountId: "gid_1",
                  },
                ];
              }
              return [];
            }
            if (method === "update") return { id: USER };
            if (method === "count") return 0;
            if (method === "deleteMany" || method === "updateMany") {
              return { count: 1 };
            }
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
  ) as PrismaClient;
  return { client, calls };
}

function ceremoniesStub() {
  return {
    attachIdentifier: vi.fn().mockResolvedValue([]),
    detachIdentifier: vi.fn().mockResolvedValue([]),
    eraseUser: vi.fn().mockResolvedValue([]),
  };
}

describe("identity adapter routing table", () => {
  describe("when the current better-auth surface is enumerated", () => {
    it("classifies every mounted model and write operation explicitly", () => {
      for (const model of ROUTED_MODELS) {
        for (const operation of WRITE_OPERATIONS) {
          expect(() => routeWrite(model, operation)).not.toThrow();
        }
      }
      // Exact sets, not subsets: a new better-auth model or operation must
      // land HERE (and in the routing table) in the same change, or the
      // unrouted-write throw plus this pin fail the build.
      expect([...ROUTED_MODELS].sort()).toEqual([
        "account",
        "ratelimit",
        "session",
        "user",
        "verification",
      ]);
      expect(WRITE_OPERATIONS).toEqual([
        "create",
        "update",
        "updateMany",
        "delete",
        "deleteMany",
        "consumeOne",
        "incrementOne",
      ]);
    });
  });

  describe("when better-auth writes to a model nobody classified", () => {
    /** @scenario "An unrouted better-auth write is refused and named" */
    it("refuses the write naming the model and operation", async () => {
      const { client } = prismaStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies: ceremoniesStub(),
        isLatched: async () => false,
      })({});
      await expect(
        adapter.create({ model: "twoFactor", data: { userId: USER } }),
      ).rejects.toBeInstanceOf(IdentityAdapterUnroutedWriteError);
      expect(() => routeWrite("twoFactor", "delete")).toThrow(
        /twoFactor.*delete/,
      );
    });
  });
});

describe("identity adapter write gate", () => {
  describe("when no user is latched", () => {
    /** @scenario "The adapter's write gate ships closed for every user" */
    it("writes protocol rows exactly as the stock adapter would and runs no ceremony", async () => {
      const { client, calls } = prismaStub();
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => false,
      })({});

      await adapter.create({
        model: "account",
        data: { userId: USER, providerId: "google", accountId: "gid_1" },
      });
      await adapter.create({
        model: "session",
        data: { userId: USER, token: "tok" },
      });

      expect(ceremonies.attachIdentifier).not.toHaveBeenCalled();
      expect(ceremonies.detachIdentifier).not.toHaveBeenCalled();
      expect(
        calls.filter((c) => c.method === "create").map((c) => c.model),
      ).toEqual(["account", "session"]);
    });
  });

  describe("when the user's backfill has latched", () => {
    /** @scenario "A latched user's domain-significant writes produce events structurally" */
    it("runs the attach ceremony before the Account row exists", async () => {
      const { client, calls } = prismaStub();
      const ceremonies = ceremoniesStub();
      const order: string[] = [];
      ceremonies.attachIdentifier.mockImplementation(async () => {
        order.push("ceremony");
        return [];
      });
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async ({ userId }) => userId === USER,
        now: () => 1_690_000_000_000,
      })({});

      await adapter.create({
        model: "account",
        data: { userId: USER, providerId: "google", accountId: "gid_1" },
      });
      order.push(
        ...calls
          .filter((c) => c.model === "account" && c.method === "create")
          .map(() => "row"),
      );

      expect(order).toEqual(["ceremony", "row"]);
      expect(ceremonies.attachIdentifier).toHaveBeenCalledWith(
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
      const ceremonies = ceremoniesStub();
      const createdAt = new Date(1_690_000_123_000);
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
        now: () => 1_700_000_000_000,
      })({});

      await adapter.create({
        model: "account",
        data: {
          userId: USER,
          providerId: "google",
          accountId: "gid_1",
          createdAt,
        },
      });

      const attach = ceremonies.attachIdentifier.mock.calls[0]?.[0] as {
        accountId: string | null;
        occurredAtMs: number;
      };
      // Business time is the row's createdAt, not the wall clock - the
      // backfill derives the identifier id from the same two values.
      expect(attach.occurredAtMs).toBe(createdAt.getTime());
      // The adapter mints the id the way the schema's `@default(nanoid())`
      // would - a default-length nanoid, not a hex string.
      expect(attach.accountId).toMatch(/^[\w-]{21}$/);
      const rowWrite = calls.find(
        (c) => c.model === "account" && c.method === "create",
      )?.args as { data: { id: string } };
      expect(rowWrite.data.id).toBe(attach.accountId);
    });

    it("detaches the identifier mirroring a deleted Account row, by accountId", async () => {
      const { client, calls } = prismaStub({
        identifierByAccount: { id: "idf_google" },
      });
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
        now: () => 1_700_000_000_000,
      })({});

      await adapter.delete({
        model: "account",
        where: [{ field: "id", value: "acc_1" }],
      });

      expect(ceremonies.detachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          identifierId: "idf_google",
          occurredAtMs: 1_700_000_000_000,
        }),
      );
      expect(
        calls.some((c) => c.model === "account" && c.method === "delete"),
      ).toBe(true);
    });

    it("deleteMany detaches one identifier per row, then deletes", async () => {
      const { client, calls } = prismaStub({
        identifierByAccount: { id: "idf_google" },
      });
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
      })({});

      await adapter.deleteMany({
        model: "account",
        where: [{ field: "userId", value: USER }],
      });

      expect(ceremonies.detachIdentifier).toHaveBeenCalledTimes(1);
      expect(
        calls.some((c) => c.model === "account" && c.method === "deleteMany"),
      ).toBe(true);
    });

    it("a row no single identifier mirrors is logged and skipped; the protocol delete still happens", async () => {
      const { client, calls } = prismaStub({
        identifierByAccount: null,
        identifiersByProvider: [{ id: "idf_a" }, { id: "idf_b" }],
      });
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
      })({});

      await adapter.delete({
        model: "account",
        where: [{ field: "id", value: "acc_1" }],
      });

      expect(ceremonies.detachIdentifier).not.toHaveBeenCalled();
      expect(
        calls.some((c) => c.model === "account" && c.method === "delete"),
      ).toBe(true);
    });

    it("falls back to the user's single live identifier on the provider", async () => {
      const { client } = prismaStub({
        identifierByAccount: null,
        identifiersByProvider: [{ id: "idf_only" }],
      });
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
      })({});

      await adapter.delete({
        model: "account",
        where: [{ field: "id", value: "acc_1" }],
      });

      expect(ceremonies.detachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({ identifierId: "idf_only" }),
      );
    });

    it("a domain write inside a transaction is routed but runs no ceremony", async () => {
      const { client, calls } = prismaStub();
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
      })({});

      await adapter.transaction(async (trx) => {
        await trx.create({
          model: "account",
          data: { userId: USER, providerId: "google", accountId: "gid_1" },
        });
        // The routing guard refuses synchronously, before any promise exists.
        expect(() => trx.create({ model: "unrouted-model", data: {} })).toThrow(
          IdentityAdapterUnroutedWriteError,
        );
      });

      expect(ceremonies.attachIdentifier).not.toHaveBeenCalled();
      expect(
        calls.some((c) => c.model === "account" && c.method === "create"),
      ).toBe(true);
    });

    it("a vetoed ceremony refuses the protocol write too", async () => {
      const { client, calls } = prismaStub();
      const ceremonies = ceremoniesStub();
      ceremonies.detachIdentifier.mockRejectedValue(
        new IdentityPrimaryMustDemoteFirstError("refused"),
      );
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
      })({});

      await expect(
        adapter.delete({
          model: "account",
          where: [{ field: "id", value: "acc_1" }],
        }),
      ).rejects.toMatchObject({ code: "identity_primary_must_demote_first" });
      expect(
        calls.some((c) => c.model === "account" && c.method === "delete"),
      ).toBe(false);
    });
  });

  describe("when better-auth deletes a user", () => {
    /** @scenario "Deleting a latched user runs the erase ceremony before the row delete" */
    it("runs the erase ceremony for a latched user before the row delete", async () => {
      const order: string[] = [];
      const { client } = prismaStub({
        // Recorded at invocation, so the pin fails if the protocol delete
        // ever runs ahead of the ceremony.
        onCall: (call) => {
          if (call.model === "user" && call.method === "delete") {
            order.push("row");
          }
        },
      });
      const ceremonies = ceremoniesStub();
      ceremonies.eraseUser.mockImplementation(async () => {
        order.push("ceremony");
        return [];
      });
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async ({ userId }) => userId === USER,
        now: () => 1_700_000_000_000,
      })({});

      await adapter.delete({
        model: "user",
        where: [{ field: "id", value: USER }],
      });

      expect(order).toEqual(["ceremony", "row"]);
      expect(ceremonies.eraseUser).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: USER,
          userId: USER,
          occurredAtMs: 1_700_000_000_000,
          actor: { type: "user", id: USER },
        }),
      );
    });

    it("deleteMany erases each latched user before the rows go", async () => {
      const { client, calls } = prismaStub();
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => true,
      })({});

      await adapter.deleteMany({
        model: "user",
        where: [{ field: "id", value: USER }],
      });

      expect(ceremonies.eraseUser).toHaveBeenCalledTimes(1);
      expect(
        calls.some((c) => c.model === "user" && c.method === "deleteMany"),
      ).toBe(true);
    });

    /** @scenario "Deleting an unlatched user runs no ceremony; the erasure service reconciles" */
    it("runs no ceremony for an unlatched user; the row delete still happens", async () => {
      const { client, calls } = prismaStub();
      const ceremonies = ceremoniesStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies,
        isLatched: async () => false,
      })({});

      await adapter.delete({
        model: "user",
        where: [{ field: "id", value: USER }],
      });

      expect(ceremonies.eraseUser).not.toHaveBeenCalled();
      expect(
        calls.some((c) => c.model === "user" && c.method === "delete"),
      ).toBe(true);
    });
  });

  describe("when a user row is created", () => {
    it("mints the userHashKey after the row exists, guarded so an existing key is never overwritten", async () => {
      const { client, calls } = prismaStub();
      const adapter = createIdentityDatabase({
        prisma: client,
        ceremonies: ceremoniesStub(),
        isLatched: async () => false,
      })({});

      await adapter.create({
        model: "user",
        data: { email: "sam@acme.com" },
      });

      const mint = calls.find(
        (c) => c.model === "user" && c.method === "updateMany",
      );
      expect(mint).toBeDefined();
      const args = mint!.args as {
        where: { id: string; userHashKey: null };
        data: { userHashKey: string };
      };
      expect(args.where.userHashKey).toBeNull();
      expect(args.data.userHashKey).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

describe("identifier provider mapping", () => {
  it("maps better-auth providerIds into the identifier vocabulary", () => {
    expect(identifierProviderFor("credential")).toBe("credential");
    expect(identifierProviderFor("google")).toBe("google");
    expect(identifierProviderFor("microsoft")).toBe("azure-ad");
    expect(identifierProviderFor("auth0")).toBe("oidc");
    expect(identifierProviderFor("okta")).toBe("oidc");
  });
});
