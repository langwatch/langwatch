/**
 * @vitest-environment node
 *
 * Provider credential rotation has to reach the gateway.
 *
 * The gateway caches a materialised bundle per virtual key, and that bundle
 * carries the decrypted provider credential. Two things move a rotation into
 * a running gateway, and this file covers both against real PG.
 *
 *   1. The change feed. `ModelProviderService` appends
 *      `MODEL_PROVIDER_UPDATED`, the gateway's change poller evicts every
 *      cached bundle whose credential list holds that provider id, and the
 *      next request re-materialises. This is the fast path.
 *   2. The config ETag. Every 60 seconds the gateway revalidates a cached
 *      bundle with `If-None-Match`. The token has to move when the config
 *      behind it moves, or the control plane answers 304 to a bundle that is
 *      no longer current and the safety net confirms stale credentials
 *      forever. This is the path that also covers a write which never went
 *      through the service, such as a seeding script.
 *
 * Spec: specs/ai-gateway/governance/provider-credential-rotation.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { getApp } from "~/server/app-layer";
import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { computeConfigETag } from "../configETag";

wireDefaultTestApp();

const suffix = nanoid(8);
const ORG_ID = `org-rot-${suffix}`;
const TEAM_ID = `team-rot-${suffix}`;
const PROJECT_ID = `proj-rot-${suffix}`;
const USER_ID = `usr-rot-${suffix}`;
const MP_ID = `mp-rot-${suffix}`;
const VK_ID = `vk-rot-${suffix}`;

/** Change-feed rows this organization produced, newest last. */
async function changeEvents() {
  return await prisma.gatewayChangeEvent.findMany({
    where: { organizationId: ORG_ID },
    orderBy: { revision: "asc" },
    select: { kind: true, modelProviderId: true },
  });
}

/** The key as the config route loads it, relations and all. */
async function loadVk() {
  return await prisma.virtualKey.findUniqueOrThrow({
    where: { id: VK_ID },
    include: { scopes: true, routingPolicy: true },
  });
}

async function etag() {
  return await computeConfigETag({ prisma, virtualKey: await loadVk() });
}

describe("provider credential rotation reaches the gateway", () => {
  beforeAll(async () => {
    await startTestContainers();
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
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.modelProvider.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  });

  /** @scenario "replacing a stored credential tells the gateway to drop its copy" */
  it("appends MODEL_PROVIDER_UPDATED when a stored credential is replaced", async () => {
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });

    await getApp().modelProviders.upsert({
      id: MP_ID,
      organizationId: ORG_ID,
      provider: "openai",
      enabled: true,
      customKeys: { OPENAI_API_KEY: "fake-rotated-first" },
    });

    expect(await changeEvents()).toEqual([
      { kind: "MODEL_PROVIDER_UPDATED", modelProviderId: MP_ID },
    ]);
  });

  /** @scenario "disabling a provider tells the gateway to drop its copy" */
  it("appends MODEL_PROVIDER_UPDATED when a provider is disabled", async () => {
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });

    await getApp().modelProviders.upsert({
      id: MP_ID,
      organizationId: ORG_ID,
      provider: "openai",
      enabled: false,
      customKeys: { OPENAI_API_KEY: "fake-rotated-first" },
    });

    expect(await changeEvents()).toEqual([
      { kind: "MODEL_PROVIDER_UPDATED", modelProviderId: MP_ID },
    ]);

    // Put it back so the later cases run against an enabled row.
    await getApp().modelProviders.upsert({
      id: MP_ID,
      organizationId: ORG_ID,
      provider: "openai",
      enabled: true,
      customKeys: { OPENAI_API_KEY: "fake-rotated-first" },
    });
  });

  /** @scenario "a credential written straight to the row still moves the version token" */
  it("moves the config ETag when the credential changes without a key edit", async () => {
    const before = await computeConfigETag({
      prisma,
      virtualKey: await loadVk(),
    });

    // A write straight to the row, which is what a seeding script or a
    // migration does. The virtual key is untouched, so its revision cannot
    // carry this change on its own.
    await prisma.modelProvider.update({
      where: { id: MP_ID },
      data: { customKeys: { OPENAI_API_KEY: "fake-rotated-direct" } },
    });

    const after = await computeConfigETag({
      prisma,
      virtualKey: await loadVk(),
    });

    expect(after).not.toEqual(before);
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
    const before = await computeConfigETag({
      prisma,
      virtualKey: await loadVk(),
    });

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

  /** @scenario "a key nobody touched keeps its version token" */
  it("keeps the config ETag stable when nothing changed", async () => {
    const first = await computeConfigETag({
      prisma,
      virtualKey: await loadVk(),
    });
    const second = await computeConfigETag({
      prisma,
      virtualKey: await loadVk(),
    });

    expect(second).toEqual(first);
  });

  /** @scenario "a change to the virtual key alone still moves the version token" */
  it("moves the config ETag when the virtual key itself changes", async () => {
    const before = await computeConfigETag({
      prisma,
      virtualKey: await loadVk(),
    });

    await prisma.virtualKey.update({
      where: { id: VK_ID },
      data: { revision: { increment: 1n } },
    });

    expect(await etag()).not.toEqual(before);
  });

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

  /** @scenario "deleting a provider tells the gateway to drop its copy" */
  it("appends MODEL_PROVIDER_UPDATED when a provider is deleted", async () => {
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });

    await getApp().modelProviders.delete({
      id: MP_ID,
      organizationId: ORG_ID,
      provider: "openai",
    });

    expect(await changeEvents()).toEqual([
      { kind: "MODEL_PROVIDER_UPDATED", modelProviderId: MP_ID },
    ]);
  });
});
