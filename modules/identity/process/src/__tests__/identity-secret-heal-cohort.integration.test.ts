/**
 * The heal pass's cohort is only users whose legacy secrets could have drifted (Q64).
 * Spec: specs/identity/identity-storage-adapter.feature.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaIdentitySecretCarryRepository } from "../repositories/prisma/prisma.identity-secret-carry.repository.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { IdentitySecretHealMigrationService } from "../services/system-migration-identity-secret-heal.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const EARLIER = new Date("2026-01-01T00:00:00Z");
const LATER = new Date("2026-01-02T00:00:00Z");

describe.skipIf(!DB_URL)("the identity heal pass's candidate tenants", () => {
  const namespace = `heal-cohort-${nanoid(8)}`;
  const users: Record<"none" | "level" | "drifted" | "uncarried", string> = {
    none: "",
    level: "",
    drifted: "",
    uncarried: "",
  };
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:heal-cohort"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const heal = IdentitySecretHealMigrationService.create(
    IdentitySecretCarryService.create(PrismaIdentitySecretCarryRepository.create(prisma)),
  );

  async function userWith(key: keyof typeof users, account?: { credentialAt: Date | null }) {
    const user = await prisma.user.create({
      data: { name: key, email: `${key}-${namespace}@example.com` },
    });
    users[key] = user.id;
    if (!account) return;
    const accountId = `${namespace}-${key}`;
    await prisma.account.create({
      data: {
        id: accountId,
        userId: user.id,
        type: "credential",
        provider: "credential",
        providerAccountId: user.id,
        password: "content-marker",
        createdAt: EARLIER,
        updatedAt: LATER,
      },
    });
    if (account.credentialAt === null) return;
    await prisma.accountCredential.create({
      data: {
        id: accountId,
        userId: user.id,
        provider: "credential",
        password: "content-marker",
        createdAt: EARLIER,
        updatedAt: account.credentialAt,
      },
    });
  }

  async function cohort(): Promise<Set<string>> {
    const named = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const page = await heal.candidateTenants.findTenantIdsAfter({ cursor, limit: 500 });
      if (page.length === 0) return named;
      for (const id of page) named.add(id);
      cursor = page[page.length - 1] ?? null;
    }
  }

  beforeAll(async () => {
    await userWith("none");
    await userWith("level", { credentialAt: LATER });
    await userWith("drifted", { credentialAt: EARLIER });
    await userWith("uncarried", { credentialAt: null });
  });

  afterAll(async () => {
    const ids = Object.values(users).filter(Boolean);
    await cleanupTestRows(prisma, [
      ["accountCredential", { userId: { in: ids } }],
      ["account", { userId: { in: ids } }],
      ["user", { id: { in: ids } }],
    ]);
    await prisma.$disconnect();
  });

  /** @scenario "The heal pass enumerates only users whose legacy secrets could have drifted" */
  it("names the drifted user and neither the user with no account nor the level one", async () => {
    const named = await cohort();

    expect(named.has(users.drifted)).toBe(true);
    expect(named.has(users.none)).toBe(false);
    expect(named.has(users.level)).toBe(false);
  });

  /** @scenario "A user whose secrets have not been carried across yet is still enumerated" */
  it("names a user whose Account row has no credential row yet", async () => {
    expect((await cohort()).has(users.uncarried)).toBe(true);
  });
});
