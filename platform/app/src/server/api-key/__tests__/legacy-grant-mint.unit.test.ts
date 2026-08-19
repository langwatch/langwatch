import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import type { ApiKeyWithBindings } from "../api-key.repository";
import {
  genesisImportMoment,
  legacyGrantForKey,
  mintLegacyKeyGrant,
  resetLegacyMintGuardForTests,
} from "../legacy-grant-mint";
import {
  afterGenesis,
  CREATED_AT,
  GENESIS_AT,
  KEY_ID,
  ORG_ID,
  onMigratedOrg,
  serviceKey,
  settle,
  writerSpy,
} from "./legacy-grant-mint.fixtures";

/** The suite's default mint: an org past genesis, a key from before it. */
const mintDefault = (writer: GrantsLedgerWriter) =>
  mintLegacyKeyGrant({
    apiKey: serviceKey(),
    writer,
    onLedgerWrites: onMigratedOrg,
    genesisMomentFor: afterGenesis,
  });

describe("legacy API key read-through mint", () => {
  beforeEach(() => {
    resetLegacyMintGuardForTests();
  });

  describe("given a service key holding no grants", () => {
    /** @scenario "A legacy service key states its access the first time it is used" */
    it("mints the organization-scoped admin grant the mint path already documents", async () => {
      const { attachBindings, writer } = writerSpy();

      mintDefault(writer);
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

      mintDefault(writer);
      await settle();

      expect(attachBindings.mock.calls[0]![0].occurredAtMs).toBe(
        CREATED_AT.getTime(),
      );
    });

    /** @scenario "The mint never holds up the request that triggered it" */
    it("does not wait for the projection", async () => {
      const { attachBindings, writer } = writerSpy();

      mintDefault(writer);
      await settle();

      expect(attachBindings.mock.calls[0]![0].awaitProjection).toBe(false);
    });

    /** @scenario "A key that is busy authenticating mints once, not once per request" */
    it("emits once while the projection is still catching up", async () => {
      const { attachBindings, writer } = writerSpy();

      mintDefault(writer);
      mintDefault(writer);
      await settle();

      expect(attachBindings).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A key that is busy authenticating mints once, not once per request" */
    it("emits again once the note expires, so the guard is a cache and not a record", async () => {
      const { attachBindings, writer } = writerSpy();
      const startedAt = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
      try {
        mintDefault(writer);
        await settle();

        clock.mockReturnValue(startedAt + 61_000);
        mintDefault(writer);
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

      expect(() => mintDefault(writer)).not.toThrow();
      await settle();

      mintDefault(writer);
      await settle();
      expect(attachBindings).toHaveBeenCalledTimes(2);
    });

    /** @scenario "A mint that fails leaves the credential working" */
    it("swallows a synchronous failure too", () => {
      const attachBindings = vi.fn().mockImplementation(() => {
        throw new Error("no event-sourcing stack");
      });
      const writer = { attachBindings } as unknown as GrantsLedgerWriter;

      expect(() => mintDefault(writer)).not.toThrow();
    });
  });
});

describe("genesisImportMoment()", () => {
  const findUnique = vi.fn();
  const prisma = { systemMigrationTenantState: { findUnique } };

  beforeEach(() => {
    findUnique.mockReset();
  });

  describe("given an organization parked for weeks before it migrated", () => {
    /** @scenario "A key born during a parked genesis import still mints once the organization migrates" */
    it("uses the migrated transition's own time, not the parked row's first appearance", async () => {
      // The row first appeared weeks earlier as `parked`; `createdAt` still
      // reflects that, but `occurredAt` has since been overwritten with the
      // `migrated` transition's own business time.
      findUnique.mockResolvedValue({
        status: "migrated",
        createdAt: new Date("2024-05-01T00:00:00.000Z"),
        occurredAt: new Date("2024-06-01T00:00:00.000Z"),
      });

      const moment = await genesisImportMoment({
        organizationId: "org_1",
        prisma,
      });

      expect(moment).toEqual(new Date("2024-06-01T00:00:00.000Z"));
    });
  });

  describe("given an organization that finalized cleanly", () => {
    it("uses the finalized row's occurredAt", async () => {
      findUnique.mockResolvedValue({
        status: "finalized",
        createdAt: new Date("2024-05-01T00:00:00.000Z"),
        occurredAt: new Date("2024-06-01T00:00:00.000Z"),
      });

      const moment = await genesisImportMoment({
        organizationId: "org_1",
        prisma,
      });

      expect(moment).toEqual(new Date("2024-06-01T00:00:00.000Z"));
    });
  });

  describe("given an organization still parked", () => {
    it("reports no cutover yet", async () => {
      findUnique.mockResolvedValue({
        status: "parked",
        createdAt: new Date("2024-05-01T00:00:00.000Z"),
        occurredAt: new Date("2024-05-01T00:00:00.000Z"),
      });

      const moment = await genesisImportMoment({
        organizationId: "org_1",
        prisma,
      });

      expect(moment).toBeNull();
    });
  });

  describe("given an organization rolled back", () => {
    it("reports no cutover", async () => {
      findUnique.mockResolvedValue({
        status: "rolled_back",
        createdAt: new Date("2024-05-01T00:00:00.000Z"),
        occurredAt: new Date("2024-07-01T00:00:00.000Z"),
      });

      const moment = await genesisImportMoment({
        organizationId: "org_1",
        prisma,
      });

      expect(moment).toBeNull();
    });
  });

  describe("given no state row at all", () => {
    it("returns null rather than assuming the organization has migrated", async () => {
      findUnique.mockResolvedValue(null);

      const moment = await genesisImportMoment({
        organizationId: "org_1",
        prisma,
      });

      expect(moment).toBeNull();
    });
  });

  describe("when the state table cannot be read", () => {
    it("fails safe to null", async () => {
      findUnique.mockRejectedValue(new Error("connection refused"));

      const moment = await genesisImportMoment({
        organizationId: "org_1",
        prisma,
      });

      expect(moment).toBeNull();
    });
  });
});
