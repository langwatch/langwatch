import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import type { ApiKeyWithBindings } from "../api-key.repository";
import { ApiKeyService } from "../api-key.service";
import {
  legacyGrantForKey,
  mintLegacyKeyGrant,
  resetLegacyMintGuardForTests,
} from "../legacy-grant-mint";

vi.mock("../api-key-token.utils", () => ({
  generateApiKeyToken: vi.fn(),
  splitApiKeyToken: () => ({ lookupId: "lookup_1", secret: "secret" }),
  verifySecret: () => "match",
  hashSecret: () => "hashed",
  INGEST_KEY_PREFIX: "ik-lw-",
}));

const ORG_ID = "org_1";
const KEY_ID = "apikey_1";
const CREATED_AT = new Date("2024-03-01T10:00:00.000Z");
/** The organization's genesis import began after this key was created. */
const GENESIS_AT = new Date("2024-06-01T00:00:00.000Z");

function serviceKey(
  overrides: Partial<ApiKeyWithBindings> = {},
): ApiKeyWithBindings {
  return {
    id: KEY_ID,
    name: "deploy bot",
    organizationId: ORG_ID,
    userId: null,
    createdAt: CREATED_AT,
    ingestSourceType: null,
    roleBindings: [],
    ...overrides,
  } as ApiKeyWithBindings;
}

function writerSpy() {
  const attachBindings = vi
    .fn()
    .mockResolvedValue({ attached: [], duplicates: [] });
  return {
    attachBindings,
    writer: { attachBindings } as unknown as GrantsLedgerWriter,
  };
}

/** Lets the fire-and-forget promise settle before assertions on failure. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The mint is per-organization; these cases are about an org past genesis. */
const onMigratedOrg = async () => true;

/** The key under test predates this organization's genesis import. */
const afterGenesis = async () => GENESIS_AT;

describe("legacy API key read-through mint", () => {
  beforeEach(() => {
    resetLegacyMintGuardForTests();
  });

  describe("given a service key holding no grants", () => {
    /** @scenario "A legacy service key states its access the first time it is used" */
    it("mints the organization-scoped admin grant the mint path already documents", async () => {
      const { attachBindings, writer } = writerSpy();

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).toHaveBeenCalledTimes(1);
      const call = attachBindings.mock.calls[0]![0];
      expect(call.organizationId).toBe(ORG_ID);
      expect(call.source).toBe("read-through-mint");
      expect(call.actor).toEqual({
        type: "system",
        id: "system:read-through-mint",
      });
      expect(call.onDuplicate).toBe("skip");
      expect(call.bindings).toHaveLength(1);
      expect(call.bindings[0]).toMatchObject({
        principal: { apiKeyId: KEY_ID },
        role: "ADMIN",
        customRoleId: null,
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
    });

    /** @scenario "A legacy service key states its access the first time it is used" */
    it("carries the key's own creation time as the fact's business time", async () => {
      const { attachBindings, writer } = writerSpy();

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings.mock.calls[0]![0].occurredAtMs).toBe(
        CREATED_AT.getTime(),
      );
    });

    /** @scenario "The mint never holds up the request that triggered it" */
    it("does not wait for the projection", async () => {
      const { attachBindings, writer } = writerSpy();

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings.mock.calls[0]![0].awaitProjection).toBe(false);
    });

    /** @scenario "A key that is busy authenticating mints once, not once per request" */
    it("emits once while the projection is still catching up", async () => {
      const { attachBindings, writer } = writerSpy();

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A key that is busy authenticating mints once, not once per request" */
    it("emits again once the note expires, so the guard is a cache and not a record", async () => {
      const { attachBindings, writer } = writerSpy();
      const startedAt = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
      try {
        mintLegacyKeyGrant({
          apiKey: serviceKey(),
          writer,
          onLedgerWrites: onMigratedOrg,
          genesisMomentFor: afterGenesis,
        });
        await settle();

        clock.mockReturnValue(startedAt + 61_000);
        mintLegacyKeyGrant({
          apiKey: serviceKey(),
          writer,
          onLedgerWrites: onMigratedOrg,
          genesisMomentFor: afterGenesis,
        });
        await settle();

        expect(attachBindings).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });

    it("derives the same identity for the same fact, so a repeat dedupes", () => {
      const first = legacyGrantForKey(serviceKey());
      const second = legacyGrantForKey(serviceKey());

      expect(first?.bindingId).toBe(second?.bindingId);
    });
  });

  describe("given an organization the genesis import has not reached", () => {
    it("mints nothing, leaving the key's legacy branch to decide", async () => {
      const { attachBindings, writer } = writerSpy();

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: async () => false,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });

    it("mints on the first use after the organization migrates", async () => {
      const { attachBindings, writer } = writerSpy();
      let migrated = false;

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: async () => migrated,
        genesisMomentFor: afterGenesis,
      });
      await settle();
      expect(attachBindings).not.toHaveBeenCalled();

      migrated = true;
      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: async () => migrated,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a key created after the organization's genesis import", () => {
    it("mints nothing, so an empty binding set is never widened to organization admin", async () => {
      const { attachBindings, writer } = writerSpy();
      const bornOnLedger = serviceKey({
        createdAt: new Date(GENESIS_AT.getTime() + 60_000),
      });

      mintLegacyKeyGrant({
        apiKey: bornOnLedger,
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });

    it("mints nothing for a key created at the genesis moment itself", async () => {
      const { attachBindings, writer } = writerSpy();

      mintLegacyKeyGrant({
        apiKey: serviceKey({ createdAt: GENESIS_AT }),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });

    it("mints nothing while a replace has attached but not yet revoked", async () => {
      const { attachBindings, writer } = writerSpy();
      // The transient window a de-transactioned write leaves: the key holds
      // no bindings for an instant, and it was created long after genesis.
      const midReplace = serviceKey({
        createdAt: new Date(GENESIS_AT.getTime() + 86_400_000),
        roleBindings: [],
      });

      mintLegacyKeyGrant({
        apiKey: midReplace,
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("given an organization with no genesis import state to read", () => {
    it("mints nothing rather than assuming the key is old", async () => {
      const { attachBindings, writer } = writerSpy();

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: async () => null,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("given a key that states its access already", () => {
    /** @scenario "A key that already states its access mints nothing" */
    it("mints nothing", async () => {
      const { attachBindings, writer } = writerSpy();
      const bound = serviceKey({
        roleBindings: [{ id: "rb_1" }] as ApiKeyWithBindings["roleBindings"],
      });

      expect(legacyGrantForKey(bound)).toBeNull();
      mintLegacyKeyGrant({
        apiKey: bound,
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("given a key owned by a user", () => {
    /** @scenario "A key owned by a user mints nothing it did not already have" */
    it("mints nothing, because zero bindings grants nothing there", async () => {
      const { attachBindings, writer } = writerSpy();
      const personal = serviceKey({ userId: "user_1" });

      expect(legacyGrantForKey(personal)).toBeNull();
      mintLegacyKeyGrant({
        apiKey: personal,
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("given an ingestion key", () => {
    it("mints nothing, so a missing binding never widens it", async () => {
      const { attachBindings, writer } = writerSpy();
      const ingestion = serviceKey({ ingestSourceType: "claude_code" });

      expect(legacyGrantForKey(ingestion)).toBeNull();
      mintLegacyKeyGrant({
        apiKey: ingestion,
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();

      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the ledger refuses the write", () => {
    /** @scenario "A mint that fails leaves the credential working" */
    it("swallows an asynchronous failure and retries on the next use", async () => {
      const attachBindings = vi
        .fn()
        .mockRejectedValueOnce(new Error("queue down"))
        .mockResolvedValue({ attached: [], duplicates: [] });
      const writer = { attachBindings } as unknown as GrantsLedgerWriter;

      expect(() =>
        mintLegacyKeyGrant({
          apiKey: serviceKey(),
          writer,
          onLedgerWrites: onMigratedOrg,
          genesisMomentFor: afterGenesis,
        }),
      ).not.toThrow();
      await settle();

      mintLegacyKeyGrant({
        apiKey: serviceKey(),
        writer,
        onLedgerWrites: onMigratedOrg,
        genesisMomentFor: afterGenesis,
      });
      await settle();
      expect(attachBindings).toHaveBeenCalledTimes(2);
    });

    /** @scenario "A mint that fails leaves the credential working" */
    it("swallows a synchronous failure too", () => {
      const attachBindings = vi.fn().mockImplementation(() => {
        throw new Error("no event-sourcing stack");
      });
      const writer = { attachBindings } as unknown as GrantsLedgerWriter;

      expect(() =>
        mintLegacyKeyGrant({
          apiKey: serviceKey(),
          writer,
          onLedgerWrites: onMigratedOrg,
          genesisMomentFor: afterGenesis,
        }),
      ).not.toThrow();
    });
  });
});

describe("API key verification", () => {
  beforeEach(() => {
    resetLegacyMintGuardForTests();
  });

  function serviceWith({
    apiKey,
    mintLegacyGrant,
  }: {
    apiKey: ApiKeyWithBindings | null;
    mintLegacyGrant: (args: { apiKey: ApiKeyWithBindings }) => void;
  }) {
    const repo = {
      findByLookupId: vi.fn().mockResolvedValue(apiKey),
      upgradeHash: vi.fn().mockResolvedValue(undefined),
    };
    return new ApiKeyService({
      prisma: {} as never,
      repo: repo as never,
      roleRepo: {} as never,
      mintLegacyGrant,
    });
  }

  describe("when a legacy key verifies", () => {
    /** @scenario "A legacy service key states its access the first time it is used" */
    it("mints its grant on the resolution path", async () => {
      const mintLegacyGrant = vi.fn();
      const apiKey = serviceKey();
      const service = serviceWith({ apiKey, mintLegacyGrant });

      await expect(service.verify({ token: "sk-lw-x_y" })).resolves.toBe(
        apiKey,
      );

      expect(mintLegacyGrant).toHaveBeenCalledWith({ apiKey });
    });
  });

  describe("when the credential does not resolve", () => {
    it("mints nothing", async () => {
      const mintLegacyGrant = vi.fn();
      const service = serviceWith({ apiKey: null, mintLegacyGrant });

      await expect(service.verify({ token: "sk-lw-x_y" })).resolves.toBeNull();

      expect(mintLegacyGrant).not.toHaveBeenCalled();
    });
  });

  describe("when a revoked key is presented", () => {
    it("mints nothing", async () => {
      const mintLegacyGrant = vi.fn();
      const service = serviceWith({
        apiKey: serviceKey({ revokedAt: new Date() }),
        mintLegacyGrant,
      });

      await expect(service.verify({ token: "sk-lw-x_y" })).resolves.toBeNull();

      expect(mintLegacyGrant).not.toHaveBeenCalled();
    });
  });
});
