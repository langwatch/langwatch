/**
 * @vitest-environment node
 *
 * Integration coverage for POST /api/auth/cli/logout — CLI-side
 * revocation that complements `langwatch logout`'s local config wipe.
 * Hits real Redis and, for the key cascade, real Postgres. No mocks.
 *
 * Cases:
 *   1. With refresh + access tokens → both deleted from Redis.
 *   2. With only refresh token → refresh deleted, access (if any) untouched.
 *   3. With only access token → access deleted, refresh (if any) untouched.
 *   4. With neither token → 200 (idempotent no-op).
 *   5. With unknown tokens → 200 (idempotent, just nothing to delete).
 *   6. With a session that minted keys → its login key and the ingest keys
 *      under it are revoked; another session's keys are left live.
 *
 * Spec: specs/ai-gateway/governance/cli-login.feature
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
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
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { app } from "../auth-cli";

const suffix = nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "0");
const ORG_ID = `org-lgo-${suffix}`;
const USER_ID = `usr-lgo-${suffix}`;

/** The container's connection, handed to the test App so the route shares it. */
let redisConnection: Redis | null = null;

async function callLogout(body: Record<string, unknown>) {
  return await app.request("/api/auth/cli/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function plant(prefix: string, token: string) {
  if (!redisConnection) throw new Error("Redis required");
  await redisConnection.set(
    `${prefix}${token}`,
    JSON.stringify({ user_id: "u", organization_id: "o" }),
    "EX",
    3600,
  );
}
async function exists(prefix: string, token: string): Promise<boolean> {
  if (!redisConnection) throw new Error("Redis required");
  return (await redisConnection.exists(`${prefix}${token}`)) === 1;
}

interface Session {
  refreshToken: string;
  accessToken: string;
  loginKeyId: string;
  ingestKeys: Array<{ sourceType: string; token: string; id: string }>;
}

/**
 * A signed-in device with keys under it: the login key /exchange mints, the
 * ingest keys the CLI mints under that session, and the token records the
 * logout route reads the login key's id back from.
 */
async function openSession({
  hostname,
  sourceTypes,
}: {
  hostname: string;
  sourceTypes: string[];
}): Promise<Session> {
  const deviceLabel = `${hostname}-${suffix}`;
  const minted = await CliLoginKeyService.create(prisma).mintForDeviceSession({
    userId: USER_ID,
    organizationId: ORG_ID,
    deviceLabel,
    selection: {
      bindings: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      permissions: ["traces:create"],
    },
    sessionStartedAtMs: Date.now(),
    maxSessionDurationDays: 0,
    refreshWindowMs: 90 * 24 * 60 * 60 * 1000,
  });
  const ingestKeys = [];
  for (const sourceType of sourceTypes) {
    const issued = await IngestionKeyService.create(prisma).mint({
      userId: USER_ID,
      organizationId: ORG_ID,
      sourceType,
      parentApiKeyId: minted.apiKeyId,
      createdByDeviceLabel: deviceLabel,
    });
    ingestKeys.push({ sourceType, token: issued.token, id: issued.apiKeyId });
  }
  const refreshToken = `lw_rt_${hostname}-${suffix}`;
  const accessToken = `lw_at_${hostname}-${suffix}`;
  const record = JSON.stringify({
    user_id: USER_ID,
    organization_id: ORG_ID,
    issued_at: Date.now(),
    expires_at: Date.now() + 3600_000,
    client_info: { hostname: deviceLabel, platform: "darwin" },
    cli_api_key_id: minted.apiKeyId,
  });
  if (!redisConnection) throw new Error("Redis required");
  await redisConnection.set(
    `lwcli:refresh:${refreshToken}`,
    record,
    "EX",
    3600,
  );
  await redisConnection.set(`lwcli:access:${accessToken}`, record, "EX", 3600);
  return { refreshToken, accessToken, loginKeyId: minted.apiKeyId, ingestKeys };
}

async function keyState(id: string) {
  return prisma.apiKey.findUniqueOrThrow({
    where: { id },
    select: { revokedAt: true, revocationCause: true },
  });
}

describe("POST /api/auth/cli/logout", () => {
  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    // The route reads its connection off the App, so the App has to carry the
    // container's (ADR-093).
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });
  }, 60_000);

  afterAll(async () => {
    await resetApp();
    await stopTestContainers();
  }, 60_000);

  describe("when both refresh + access tokens are supplied", () => {
    it("deletes both — full revocation, no surviving credentials", async () => {
      const refresh = `lw_rt_${suffix}-both-r`;
      const access = `lw_at_${suffix}-both-a`;
      await plant("lwcli:refresh:", refresh);
      await plant("lwcli:access:", access);

      const res = await callLogout({
        refresh_token: refresh,
        access_token: access,
      });

      expect(res.status).toBe(200);
      expect(await exists("lwcli:refresh:", refresh)).toBe(false);
      expect(await exists("lwcli:access:", access)).toBe(false);
    });
  });

  describe("when only the refresh token is supplied", () => {
    it("deletes the refresh and leaves any access token in place", async () => {
      const refresh = `lw_rt_${suffix}-r-only-r`;
      const access = `lw_at_${suffix}-r-only-a`;
      await plant("lwcli:refresh:", refresh);
      await plant("lwcli:access:", access);

      const res = await callLogout({ refresh_token: refresh });

      expect(res.status).toBe(200);
      expect(await exists("lwcli:refresh:", refresh)).toBe(false);
      expect(await exists("lwcli:access:", access)).toBe(true);
    });
  });

  describe("when only the access token is supplied", () => {
    it("deletes the access and leaves any refresh token in place", async () => {
      const refresh = `lw_rt_${suffix}-a-only-r`;
      const access = `lw_at_${suffix}-a-only-a`;
      await plant("lwcli:refresh:", refresh);
      await plant("lwcli:access:", access);

      const res = await callLogout({ access_token: access });

      expect(res.status).toBe(200);
      expect(await exists("lwcli:refresh:", refresh)).toBe(true);
      expect(await exists("lwcli:access:", access)).toBe(false);
    });
  });

  describe("when neither token is supplied", () => {
    it("returns 200 idempotent — nothing to revoke", async () => {
      const res = await callLogout({});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  describe("when supplied tokens don't exist in Redis", () => {
    it("returns 200 idempotent — unknown tokens are a safe no-op", async () => {
      const res = await callLogout({
        refresh_token: `lw_rt_${suffix}-unknown`,
        access_token: `lw_at_${suffix}-unknown`,
      });
      expect(res.status).toBe(200);
    });
  });

  describe("given a laptop and a desktop session that each minted ingest keys", () => {
    const resolver = TokenResolver.create(prisma);

    beforeAll(async () => {
      await prisma.organization.create({
        data: { id: ORG_ID, name: `LGO ${suffix}`, slug: `lgo-${suffix}` },
      });
      await prisma.user.create({
        data: { id: USER_ID, email: `${USER_ID}@example.com`, name: "LGO" },
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
    });

    /** @scenario "Logging out retires the session's ingest keys and leaves another session's live" */
    /** @scenario "Logout retires the ingest keys this session minted" */
    /** @scenario "Logout revokes the copilot_app ingest key" */
    it("revokes the laptop's login key and every ingest key under it, and leaves the desktop's key working", async () => {
      const laptop = await openSession({
        hostname: "laptop",
        sourceTypes: ["claude_code", "copilot_app"],
      });
      const desktop = await openSession({
        hostname: "desktop",
        sourceTypes: ["claude_code"],
      });

      const res = await callLogout({
        refresh_token: laptop.refreshToken,
        access_token: laptop.accessToken,
      });
      expect(res.status).toBe(200);

      expect(await keyState(laptop.loginKeyId)).toMatchObject({
        revocationCause: "user",
      });
      for (const key of laptop.ingestKeys) {
        expect(await keyState(key.id)).toMatchObject({
          revocationCause: "session",
        });
        expect(
          await resolver.resolve({ token: key.token, projectId: null }),
        ).toBeNull();
      }

      expect((await keyState(desktop.loginKeyId)).revokedAt).toBeNull();
      for (const key of desktop.ingestKeys) {
        expect((await keyState(key.id)).revokedAt).toBeNull();
        expect(
          (await resolver.resolve({ token: key.token, projectId: null }))?.type,
        ).toBe("apiKey");
      }
      expect(await exists("lwcli:refresh:", desktop.refreshToken)).toBe(true);
    });
  });
});
