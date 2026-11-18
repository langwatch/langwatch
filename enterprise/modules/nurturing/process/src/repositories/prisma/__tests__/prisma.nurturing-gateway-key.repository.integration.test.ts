// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's key copy through the tenancy guards: the upsert is the fold rule in SQL, and the
 * memory twin folding the same facts must hold the same copy.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  erasedUserHashOf,
  type NurturingVirtualKeyFact,
} from "../../../rules/nurturing-virtual-key.rules.ts";
import { MemoryNurturingVirtualKeyRepository } from "../../memory/memory.nurturing-gateway-key.repository.ts";
import { PrismaNurturingVirtualKeyRepository } from "../prisma.nurturing-gateway-key.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationIds = [`test-nurturing-key-a-${run}`, `test-nurturing-key-b-${run}`];
const [firstOrganization, secondOrganization] = organizationIds as [string, string];
const keyId = (name: string) => `vk_test_${name}_${run}`;
const erasedUserIds = new Set<string>();
/** A person a test erases; their erasure mark is removed with the test's rows. */
const erasedPerson = (name: string) => {
  const userId = `test-nurturing-key-${name}-${run}`;
  erasedUserIds.add(userId);
  return userId;
};
const erased = erasedPerson("erased");

const fact = (overrides: Partial<NurturingVirtualKeyFact>): NurturingVirtualKeyFact => ({
  virtualKeyId: keyId("folded"),
  organizationId: firstOrganization,
  action: "created",
  name: "Jane's key",
  actorUserId: "user-creator",
  principalUserId: "user-first",
  purpose: "USER",
  occurredAt: 1_000,
  ...overrides,
});

describe.skipIf(!databaseUrl)("given nurturing's key copy in Postgres", () => {
  let connection: PrismaConnection;
  let keys: PrismaNurturingVirtualKeyRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:virtual-keys"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    keys = PrismaNurturingVirtualKeyRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const organizationId of organizationIds) {
      await connection.client.nurturingVirtualKey.deleteMany({ where: { organizationId } });
    }
    const userIdHash = { in: [...erasedUserIds].map(erasedUserHashOf) };
    await connection.client.nurturingErasedUser.deleteMany({ where: { userIdHash } });
    await connection.closeOnce();
  });

  describe("when a key's facts arrive late, out of order and twice", () => {
    /** @scenario "The key copy folds every lifecycle fact order-free in Postgres" */
    it("holds what the memory twin holds for the same facts", async () => {
      const disabled = fact({
        action: "disabled",
        name: "Renamed",
        principalUserId: "user-latest",
        occurredAt: 4_000,
      });
      const facts = [
        fact({ action: "rotated", name: "Renamed", actorUserId: null, occurredAt: 2_000 }),
        disabled,
        fact({}),
        fact({ action: "rotated", principalUserId: null, purpose: null, occurredAt: 5_000 }),
        fact({ action: "enabled", principalUserId: "user-middle", occurredAt: 3_000 }),
        disabled,
      ];
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const next of facts) {
        await keys.recordKeyFact({ fact: next });
        await twin.recordKeyFact({ fact: next });
      }
      const where = { organizationId: firstOrganization, virtualKeyId: keyId("folded") };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        {
          name: "Jane's key",
          occurredAt: 5_000,
          keyCreatedAt: 1_000,
          creatorUserId: "user-creator",
          principalUserId: "user-latest",
          principalUserIdAt: 4_000,
          purpose: "USER",
          disabledAt: 4_000,
          enabledAt: 3_000,
          revokedAt: null,
        },
      ]);
    });

    it("answers no copy for the key under another organization", async () => {
      await expect(
        keys.findKey({ organizationId: secondOrganization, virtualKeyId: keyId("folded") }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a fact names another organization for a copied key", () => {
    it("changes nothing, in Postgres as in the memory twin", async () => {
      const copied = fact({ virtualKeyId: keyId("fenced") });
      const elsewhere = fact({
        virtualKeyId: keyId("fenced"),
        organizationId: secondOrganization,
        action: "revoked",
        name: "Taken over",
        principalUserId: "user-elsewhere",
        occurredAt: 9_000,
      });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const next of [copied, elsewhere]) {
        await keys.recordKeyFact({ fact: next });
        await twin.recordKeyFact({ fact: next });
      }
      const where = { organizationId: firstOrganization, virtualKeyId: keyId("fenced") };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        { name: "Jane's key", principalUserId: "user-first", occurredAt: 1_000, revokedAt: null },
      ]);
      await expect(
        keys.findKey({ organizationId: secondOrganization, virtualKeyId: keyId("fenced") }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a person named on keys in two organizations is erased, twice", () => {
    /** @scenario "An erased person is cleared from every key copy in Postgres" */
    it("names them on no copy, and a redelivered older fact naming them writes nothing back", async () => {
      const held = fact({ virtualKeyId: keyId("held"), principalUserId: erased });
      const made = fact({
        virtualKeyId: keyId("made"),
        organizationId: secondOrganization,
        actorUserId: erased,
      });
      await keys.recordKeyFact({ fact: held });
      await keys.recordKeyFact({ fact: made });

      for (let delivery = 0; delivery < 2; delivery++) await keys.forgetUser({ userId: erased });
      await keys.recordKeyFact({ fact: held });
      await keys.recordKeyFact({ fact: made });

      await expect(
        keys.findKey({ organizationId: firstOrganization, virtualKeyId: keyId("held") }),
      ).resolves.toMatchObject([{ principalUserId: null, creatorUserId: "user-creator" }]);
      await expect(
        keys.findKey({ organizationId: secondOrganization, virtualKeyId: keyId("made") }),
      ).resolves.toMatchObject([{ principalUserId: "user-first", creatorUserId: null }]);
    });
  });

  describe("when a fact stamped after the holder's stamp but before their erasure lands after it", () => {
    /** @scenario "A fact stamped before an erasure never names the erased holder again" */
    it("keeps the holder cleared, in Postgres as in the memory twin", async () => {
      const lateErased = erasedPerson("late-erased");
      const virtualKeyId = keyId("late");
      const stamped = (occurredAt: number) =>
        fact({ virtualKeyId, action: "rotated", principalUserId: lateErased, occurredAt });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      // T1 < T2 < now: both stamps are in 1970, the erasure's is the clock's.
      for (const repository of [keys, twin]) {
        await repository.recordKeyFact({ fact: stamped(1_000) });
        await repository.forgetUser({ userId: lateErased });
        await repository.recordKeyFact({ fact: stamped(2_000) });
      }
      const where = { organizationId: firstOrganization, virtualKeyId };

      await expect(keys.findKey(where)).resolves.toMatchObject([{ principalUserId: null }]);
      await expect(twin.findKey(where)).resolves.toMatchObject([{ principalUserId: null }]);
    });
  });

  describe("when an erased person's created fact, stamped before the erasure, lands late", () => {
    /** @scenario "A key is created for an erased person after their erasure" */
    it("copies the key naming no creator or holder, as the memory twin does", async () => {
      const person = erasedPerson("erased-before-copy");
      const virtualKeyId = keyId("copied-after-erasure");
      // Stamped in 1970, so before the erasure's clock time.
      const created = fact({ virtualKeyId, actorUserId: person, principalUserId: person });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const repository of [keys, twin]) {
        await repository.forgetUser({ userId: person });
        await repository.recordKeyFact({ fact: created });
      }
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        {
          keyCreatedAt: 1_000,
          creatorUserId: null,
          principalUserId: null,
          principalUserIdAt: null,
        },
      ]);
    });
  });

  describe("when a holder fact naming an erased person lands late on a key with no holder", () => {
    /** @scenario "A holder change for an erased person arrives late on a key with no holder" */
    it("keeps the key holderless, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-holder");
      const virtualKeyId = keyId("holderless");
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const repository of [keys, twin]) {
        await repository.recordKeyFact({ fact: fact({ virtualKeyId, principalUserId: null }) });
        await repository.forgetUser({ userId: person });
        const holderChange = fact({
          virtualKeyId,
          action: "rotated",
          principalUserId: person,
          occurredAt: 2_000,
        });
        await repository.recordKeyFact({ fact: holderChange });
      }
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        { creatorUserId: "user-creator", principalUserId: null, principalUserIdAt: null },
      ]);
    });
  });

  describe("when a created fact naming an erased creator lands after a later fact", () => {
    /** @scenario "A late created fact never names an erased creator" */
    it("records the creation naming no creator, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-creator");
      const virtualKeyId = keyId("created-late");
      const rotated = fact({
        virtualKeyId,
        action: "rotated",
        actorUserId: null,
        occurredAt: 2_000,
      });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const repository of [keys, twin]) {
        await repository.recordKeyFact({ fact: rotated });
        await repository.forgetUser({ userId: person });
        await repository.recordKeyFact({ fact: fact({ virtualKeyId, actorUserId: person }) });
      }
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        { keyCreatedAt: 1_000, creatorUserId: null, principalUserId: "user-first" },
      ]);
    });
  });

  describe("when a later-stamped fact names an erased person as the holder of another's key", () => {
    /** @scenario "A late fact naming an erased person leaves the key's real holder in place" */
    it("keeps the real holder and their stamp, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-not-holder");
      const virtualKeyId = keyId("held-by-another");
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const repository of [keys, twin]) {
        await repository.recordKeyFact({ fact: fact({ virtualKeyId }) });
        await repository.forgetUser({ userId: person });
        const holderChange = fact({
          virtualKeyId,
          action: "rotated",
          principalUserId: person,
          occurredAt: 2_000,
        });
        await repository.recordKeyFact({ fact: holderChange });
      }
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([{ principalUserId: "user-first", principalUserIdAt: 1_000 }]);
    });
  });
});
