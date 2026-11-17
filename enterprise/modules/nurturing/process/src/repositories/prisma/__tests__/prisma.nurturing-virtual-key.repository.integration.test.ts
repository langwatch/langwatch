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

import type { NurturingVirtualKeyFact } from "../../../rules/nurturing-virtual-key.rules.ts";
import { MemoryNurturingVirtualKeyRepository } from "../../memory/memory.nurturing-virtual-key.repository.ts";
import { PrismaNurturingVirtualKeyRepository } from "../prisma.nurturing-virtual-key.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationIds = [`test-nurturing-key-a-${run}`, `test-nurturing-key-b-${run}`];
const [firstOrganization, secondOrganization] = organizationIds as [string, string];
const keyId = (name: string) => `vk_test_${name}_${run}`;
const erased = `test-nurturing-key-erased-${run}`;

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
});
