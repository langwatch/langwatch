/**
 * @vitest-environment node
 *
 * Seeding a provider credential onto a shared organization, against real PG.
 *
 * The organizations these seeders run against are shared, and a provider row
 * is org-wide. A seeder that writes whatever key the shell exported replaces
 * a credential other people are using, and the previous one is encrypted in
 * the column the write just overwrote, so there is nothing to restore from.
 *
 * This holds both writes side by side on the same row: the unconditional
 * update these seeders used to perform, and the decision the shared helper
 * makes now.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { decrypt, encrypt } from "~/utils/encryption";
import {
  decideCredentialWrite,
  readStoredCredential,
} from "../seedProviderCredential";

const suffix = nanoid(8);
const ORG_ID = `org-seedcred-${suffix}`;
const MP_ID = `mp-seedcred-${suffix}`;

const WORKING_KEY = "fake-working-abcdefgh";
const STALE_KEY = "fake-stale-from-another-repo";

async function storeWorkingKey() {
  await prisma.modelProvider.update({
    where: { id: MP_ID },
    data: {
      customKeys: encrypt(JSON.stringify({ OPENAI_API_KEY: WORKING_KEY })),
    },
  });
}

async function storedKey(): Promise<string | undefined> {
  const row = await prisma.modelProvider.findUniqueOrThrow({
    where: { id: MP_ID },
    select: { customKeys: true },
  });
  const keys = JSON.parse(decrypt(row.customKeys as string)) as Record<
    string,
    string
  >;
  return keys.OPENAI_API_KEY;
}

/**
 * The write the seeders make now: decide first, and only then update.
 *
 * `replacement` is null when the environment variable behind this provider is
 * unset, which is the case that used to clear the column.
 */
async function seedCredential({
  shouldForce,
  replacement = { OPENAI_API_KEY: STALE_KEY },
}: {
  shouldForce: boolean;
  replacement?: Record<string, string> | null;
}) {
  const row = await prisma.modelProvider.findUniqueOrThrow({
    where: { id: MP_ID },
    select: { customKeys: true },
  });
  const decision = decideCredentialWrite({
    stored: readStoredCredential(row.customKeys),
    replacement,
    shouldForce,
  });
  if (decision.action === "write") {
    await prisma.modelProvider.update({
      where: { id: MP_ID },
      data: {
        ...(replacement
          ? { customKeys: encrypt(JSON.stringify(replacement)) }
          : {}),
        enabled: true,
      },
    });
  }
  return decision;
}

describe("seeding a provider credential onto a shared organization", () => {
  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `Seed Org ${suffix}`,
        slug: `seedcred-${suffix}`,
      },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_ID,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: encrypt(JSON.stringify({ OPENAI_API_KEY: WORKING_KEY })),
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.modelProvider.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  });

  it("shows what an unconditional write costs", async () => {
    await storeWorkingKey();
    expect(await storedKey()).toBe(WORKING_KEY);

    // The write these seeders used to make: whatever the shell held, straight
    // onto the row.
    await prisma.modelProvider.update({
      where: { id: MP_ID },
      data: {
        customKeys: encrypt(JSON.stringify({ OPENAI_API_KEY: STALE_KEY })),
      },
    });

    expect(await storedKey()).toBe(STALE_KEY);
  });

  it("keeps a working credential and reports why", async () => {
    await storeWorkingKey();

    const decision = await seedCredential({ shouldForce: false });

    expect(decision).toEqual({
      action: "keep",
      reason: "a credential is already stored",
    });
    expect(await storedKey()).toBe(WORKING_KEY);
  });

  it("fills a row that has no credential yet", async () => {
    await prisma.modelProvider.update({
      where: { id: MP_ID },
      data: { customKeys: {} },
    });

    const decision = await seedCredential({ shouldForce: false });

    expect(decision).toEqual({
      action: "write",
      reason: "no stored credential",
    });
    expect(await storedKey()).toBe(STALE_KEY);
  });

  // A blob from a different CREDENTIALS_SECRET. The row keeps it and the
  // seeder must not enable or route to it, because nothing can dispatch with
  // a credential it cannot decrypt.
  it("skips a credential nothing can decrypt", async () => {
    await prisma.modelProvider.update({
      where: { id: MP_ID },
      data: { customKeys: "not-a-valid-encrypted-blob" },
    });

    const decision = await seedCredential({ shouldForce: false });

    expect(decision).toEqual({
      action: "skip",
      reason: "the stored credential cannot be read",
    });
    const row = await prisma.modelProvider.findUniqueOrThrow({
      where: { id: MP_ID },
      select: { customKeys: true },
    });
    expect(row.customKeys).toBe("not-a-valid-encrypted-blob");
  });

  // The environment variable behind a provider is often unset on a dogfood
  // run. Forcing must not turn that into an erased column: it replaces one
  // key with another, and with no replacement there is nothing to do.
  it("keeps a working credential when forced with no replacement", async () => {
    await storeWorkingKey();

    const decision = await seedCredential({
      shouldForce: true,
      replacement: null,
    });

    expect(decision).toEqual({
      action: "keep",
      reason: "a credential is already stored",
    });
    expect(await storedKey()).toBe(WORKING_KEY);
  });

  it("replaces a working credential only when forced", async () => {
    await storeWorkingKey();

    const decision = await seedCredential({ shouldForce: true });

    expect(decision).toEqual({ action: "write", reason: "forced" });
    expect(await storedKey()).toBe(STALE_KEY);
  });
});
