/**
 * @vitest-environment node
 * Real Postgres. Every 60s the gateway revalidates via If-None-Match; the token must move when config moves, including writes that bypass the service. Spec: specs/ai-gateway/governance/provider-credential-rotation.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { GatewayConfigAssemblyAdapter } from "../gateway-config-assembly.adapter";
import type { VirtualKeyWithScopes } from "../../ports/gateway-virtual-key.port";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG_ID = `org-rot-${suffix}`;
const TEAM_ID = `team-rot-${suffix}`;
const PROJECT_ID = `proj-rot-${suffix}`;
const USER_ID = `usr-rot-${suffix}`;
const MP_ID = `mp-rot-${suffix}`;
const VK_ID = `vk-rot-${suffix}`;

/** The key as the config route loads it, relations and all. */
async function loadVk(): Promise<VirtualKeyWithScopes> {
  return (await prisma.virtualKey.findUniqueOrThrow({
    where: { id: VK_ID },
    include: { scopes: true, routingPolicy: true },
  })) as unknown as VirtualKeyWithScopes;
}

async function etag() {
  return await GatewayConfigAssemblyAdapter.create({ prisma }).versionToken(await loadVk());
}

describe.skipIf(!databaseUrl)("provider credential rotation reaches the gateway", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Rot Org ${suffix}`, slug: `rot-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Rot Team ${suffix}`,
        slug: `rot-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Rot Project ${suffix}`,
        slug: `rot-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-rot-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@rot.local`, name: "Rot" },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_ID,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {},
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "vk-rotation",
        hashedSecret: `hash-rot-${suffix}`,
        displayPrefix: "lw_vk_live_rot_1",
        principalUserId: USER_ID,
        createdById: USER_ID,
        traceProjectId: PROJECT_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.modelProvider.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await connection?.closeOnce();
  }, 120_000);

  describe("given a credential written straight to the provider row", () => {
    /** @scenario "a credential written straight to the row still moves the version token" */
    it("moves the config ETag when the credential changes without a key edit", async () => {
      const before = await etag();

      // A write straight to the row, which is what a seeding script or a
      // migration does. The virtual key is untouched, so its revision cannot
      // carry this change on its own.
      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: { customKeys: { OPENAI_API_KEY: "fake-rotated-direct" } },
      });

      expect(await etag()).not.toEqual(before);
    });

    // updatedAt is TIMESTAMP(3), so a summary keyed on the newest write cannot
    // tell two writes inside one millisecond apart. The token is a digest of
    // the rows, so it moves on the content instead of on the clock.
    /** @scenario "a credential written straight to the row still moves the version token" */
    it("moves the config ETag for two writes stamped the same millisecond", async () => {
      const sameInstant = new Date("2026-08-16T12:00:00.123Z");
      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: {
          customKeys: { OPENAI_API_KEY: "fake-first-write" },
          updatedAt: sameInstant,
        },
      });
      const before = await etag();

      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: {
          customKeys: { OPENAI_API_KEY: "fake-second-write" },
          updatedAt: sameInstant,
        },
      });

      const stamps = await prisma.modelProvider.findMany({
        where: { id: MP_ID },
        select: { updatedAt: true },
      });
      expect(stamps[0]?.updatedAt).toEqual(sameInstant);
      expect(await etag()).not.toEqual(before);
    });
  });

  describe("given nothing changed at all", () => {
    /** @scenario "a key nobody touched keeps its version token" */
    it("keeps the config ETag stable", async () => {
      const first = await etag();
      const second = await etag();

      expect(second).toEqual(first);
    });
  });

  describe("given the virtual key itself changed", () => {
    /** @scenario "a change to the virtual key alone still moves the version token" */
    it("moves the config ETag", async () => {
      const before = await etag();

      await prisma.virtualKey.update({
        where: { id: VK_ID },
        data: { revision: { increment: 1n } },
      });

      expect(await etag()).not.toEqual(before);
    });
  });

  describe("given a scope row written straight to the table", () => {
    // The provider set a bundle carries is the scope-reachable subset, not the
    // organization's rows. A grant or a revoke writes ModelProviderScope and
    // touches no column of ModelProvider and no virtual key, so a token built
    // from provider columns alone cannot see the one write that decides
    // whether the key can reach the provider at all.
    /** @scenario "a scope row written straight to the table moves the version token" */
    it("moves the config ETag when a scope row is revoked and again when it is granted back", async () => {
      const reachable = await etag();

      const scope = await prisma.modelProviderScope.findFirstOrThrow({
        where: { modelProviderId: MP_ID },
        select: { id: true, scopeType: true, scopeId: true },
      });
      await prisma.modelProviderScope.delete({ where: { id: scope.id } });

      const revoked = await etag();
      expect(revoked).not.toEqual(reachable);

      await prisma.modelProviderScope.create({
        data: {
          modelProviderId: MP_ID,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
        },
      });

      const grantedBack = await etag();
      expect(grantedBack).not.toEqual(revoked);
      expect(grantedBack).toEqual(reachable);
    });

    // providers[] is the fallback chain, so the same providers in a different
    // order are a different bundle. Order is settled by
    // fallbackPriorityGlobal, which is a column no event names on its own.
    /** @scenario "a scope row written straight to the table moves the version token" */
    it("moves the config ETag when only the dispatch order changes", async () => {
      const SECOND_MP_ID = `mp-rot-second-${suffix}`;
      await prisma.modelProvider.create({
        data: {
          id: SECOND_MP_ID,
          name: "OpenAI Secondary",
          provider: "openai",
          enabled: true,
          organizationId: ORG_ID,
          fallbackPriorityGlobal: 20,
          customKeys: { OPENAI_API_KEY: "fake-secondary" },
          scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
        },
      });
      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: { fallbackPriorityGlobal: 10 },
      });
      const firstOrder = await etag();

      // Swap which one is tried first. No credential, no scope and no key
      // changes; only the order the gateway would dispatch in.
      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: { fallbackPriorityGlobal: 30 },
      });

      expect(await etag()).not.toEqual(firstOrder);

      await prisma.modelProvider.delete({ where: { id: SECOND_MP_ID } });
      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: { fallbackPriorityGlobal: null },
      });
    });
  });
});
