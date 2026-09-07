/**
 * @vitest-environment node
 *
 * `POST /api/auth/cli/refresh` and the login key's expiry: a refresh the
 * server accepts moves the key's expiry with the session, and a refresh it
 * refuses ends the session, so the login key and the ingest keys under it are
 * retired with cause "expired". Real Redis + real Postgres.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */

import { IngestionKeyService } from "@ee/governance/services/ingestionKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliLoginKeyService } from "~/server/api-key/cli-login-key.service";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { app } from "../auth-cli";

const suffix = nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "0");
const ORG_ID = `org-rfx-${suffix}`;
const USER_ID = `usr-rfx-${suffix}`;
const DAY_MS = 24 * 60 * 60 * 1000;

let redisConnection: Redis | null = null;

interface Session {
  refreshToken: string;
  loginKeyId: string;
  ingestToken: string;
  ingestKeyId: string;
}

/**
 * A session that started `ageDays` ago: a login key minted then, an ingest
 * key under it, and a refresh token record anchored at that start.
 */
async function openSession({
  hostname,
  ageDays,
}: {
  hostname: string;
  ageDays: number;
}): Promise<Session> {
  const sessionStartedAtMs = Date.now() - ageDays * DAY_MS;
  const minted = await CliLoginKeyService.create(prisma).mintForDeviceSession({
    userId: USER_ID,
    organizationId: ORG_ID,
    deviceLabel: `${hostname}-${suffix}`,
    selection: {
      bindings: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      permissions: ["traces:create"],
    },
    sessionStartedAtMs,
    maxSessionDurationDays: 0,
    refreshWindowMs: 90 * DAY_MS,
  });
  const ingest = await IngestionKeyService.create(prisma).mint({
    userId: USER_ID,
    organizationId: ORG_ID,
    sourceType: "claude_code",
    parentApiKeyId: minted.apiKeyId,
    createdByDeviceLabel: `${hostname}-${suffix}`,
  });
  const refreshToken = `lw_rt_${"r".repeat(30)}-${hostname}-${suffix}`;
  if (!redisConnection) throw new Error("Redis unavailable in test env");
  await redisConnection.set(
    `lwcli:refresh:${refreshToken}`,
    JSON.stringify({
      user_id: USER_ID,
      organization_id: ORG_ID,
      issued_at: Date.now() - 60_000,
      expires_at: Date.now() + 30 * DAY_MS,
      client_info: {
        hostname: `${hostname}-${suffix}`,
        platform: "darwin",
        session_started_at: sessionStartedAtMs,
      },
      cli_api_key_id: minted.apiKeyId,
    }),
    "EX",
    60 * 60,
  );
  return {
    refreshToken,
    loginKeyId: minted.apiKeyId,
    ingestToken: ingest.token,
    ingestKeyId: ingest.apiKeyId,
  };
}

async function refresh(refreshToken: string): Promise<number> {
  const res = await app.request("/api/auth/cli/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return res.status;
}

async function keyState(id: string) {
  return prisma.apiKey.findUniqueOrThrow({
    where: { id },
    select: { revokedAt: true, revocationCause: true, expiresAt: true },
  });
}

describe("POST /api/auth/cli/refresh and the login key's expiry", () => {
  const resolver = TokenResolver.create(prisma);

  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });

    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `RFX ${suffix}`,
        slug: `rfx-${suffix}`,
        maxSessionDurationDays: 30,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@example.com`, name: "RFX" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      },
    });
    await new PersonalWorkspaceService(prisma).ensure({
      userId: USER_ID,
      organizationId: ORG_ID,
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.roleBinding
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.apiKey
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.customRole
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { team: { organizationId: ORG_ID } } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: USER_ID } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => undefined);
    await stopTestContainers();
  });

  describe("given a session older than the organization's max session duration", () => {
    /** @scenario "A session past its ceiling has its keys retired with cause expired" */
    it("refuses the refresh and retires the login key and its ingest key with cause expired", async () => {
      const stale = await openSession({ hostname: "stale", ageDays: 45 });

      expect(await refresh(stale.refreshToken)).toBe(401);

      expect(await keyState(stale.loginKeyId)).toMatchObject({
        revocationCause: "expired",
      });
      expect((await keyState(stale.loginKeyId)).revokedAt).not.toBeNull();
      expect(await keyState(stale.ingestKeyId)).toMatchObject({
        revocationCause: "expired",
      });
      expect(
        await resolver.resolve({ token: stale.ingestToken, projectId: null }),
      ).toBeNull();
    });
  });

  describe("given a session inside the ceiling", () => {
    /** @scenario "A refresh extends the login key's expiry with the session" */
    it("accepts the refresh and moves the login key's expiry to the ceiling from the session start", async () => {
      const fresh = await openSession({ hostname: "fresh", ageDays: 10 });
      const before = await keyState(fresh.loginKeyId);

      expect(await refresh(fresh.refreshToken)).toBe(200);

      const after = await keyState(fresh.loginKeyId);
      expect(after.revokedAt).toBeNull();
      expect(after.expiresAt).not.toBeNull();
      // Minted with no ceiling, the key held the full refresh window; the
      // refresh applies the organization's 30 days from the session start.
      expect(after.expiresAt!.getTime()).toBeLessThan(
        before.expiresAt!.getTime(),
      );
      expect(after.expiresAt!.getTime()).toBeCloseTo(
        Date.now() + 20 * DAY_MS,
        -5,
      );
      expect(
        (await resolver.resolve({ token: fresh.ingestToken, projectId: null }))
          ?.type,
      ).toBe("apiKey");
    });
  });
});
