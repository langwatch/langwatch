// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * The devices tab's revoke retires the machine, telemetry included: the
 * session's login key and the ingest keys parented to it go with its tokens,
 * and the other sessions of the same person are untouched. Real Redis + real
 * Postgres.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliLoginKeyService } from "~/server/api-key/cli-login-key.service";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { CliSessionInventoryService } from "../cliSessionInventory.service";
import { CliTokenRevocationService } from "../cliTokenRevocation.service";
import { IngestionKeyService } from "../ingestionKey.service";
import { PersonalWorkspaceService } from "../personalWorkspace.service";

const suffix = nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "0");
const ORG_ID = `org-csi-${suffix}`;
const USER_ID = `usr-csi-${suffix}`;

let redisConnection: Redis | null = null;

interface Session {
  sessionStartedAtMs: number;
  accessKey: string;
  refreshKey: string;
  loginKeyId: string;
  ingestToken: string;
  ingestKeyId: string;
}

/** A device session the way /exchange leaves it, plus one ingest key under it. */
async function openSession({
  hostname,
  sessionStartedAtMs,
}: {
  hostname: string;
  sessionStartedAtMs: number;
}): Promise<Session> {
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
    refreshWindowMs: 90 * 24 * 60 * 60 * 1000,
  });
  const ingest = await IngestionKeyService.create(prisma).mint({
    userId: USER_ID,
    organizationId: ORG_ID,
    sourceType: "claude_code",
    parentApiKeyId: minted.apiKeyId,
    createdByDeviceLabel: `${hostname}-${suffix}`,
  });

  if (!redisConnection) throw new Error("Redis unavailable in test env");
  const accessKey = `lwcli:access:lw_at_${hostname}-${suffix}`;
  const refreshKey = `lwcli:refresh:lw_rt_${hostname}-${suffix}`;
  const record = {
    user_id: USER_ID,
    organization_id: ORG_ID,
    issued_at: sessionStartedAtMs,
    expires_at: Date.now() + 60 * 60 * 1000,
    client_info: {
      hostname: `${hostname}-${suffix}`,
      platform: "darwin",
      session_started_at: sessionStartedAtMs,
    },
    cli_api_key_id: minted.apiKeyId,
  };
  await redisConnection.set(accessKey, JSON.stringify(record), "EX", 3600);
  await redisConnection.set(refreshKey, JSON.stringify(record), "EX", 3600);
  await redisConnection.sadd(
    CliTokenRevocationService.userTokensIndexKey(USER_ID),
    accessKey,
    refreshKey,
  );
  return {
    sessionStartedAtMs,
    accessKey,
    refreshKey,
    loginKeyId: minted.apiKeyId,
    ingestToken: ingest.token,
    ingestKeyId: ingest.apiKeyId,
  };
}

async function keyState(id: string) {
  return prisma.apiKey.findUniqueOrThrow({
    where: { id },
    select: { revokedAt: true, revocationCause: true },
  });
}

describe("CliSessionInventoryService with the keys a session owns", () => {
  const resolver = TokenResolver.create(prisma);
  let service: CliSessionInventoryService;

  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    service = CliSessionInventoryService.create({
      redis: redisConnection,
      prisma,
    });

    await prisma.organization.create({
      data: { id: ORG_ID, name: `CSI ${suffix}`, slug: `csi-${suffix}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@example.com`, name: "CSI" },
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
    if (redisConnection) {
      await redisConnection.del(
        CliTokenRevocationService.userTokensIndexKey(USER_ID),
      );
    }
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

  describe("given a laptop and a desktop session, each with a claude_code key", () => {
    /** @scenario "Revoking a device from the devices tab retires its login key and its ingest keys" */
    it("revoking the laptop retires its tokens, login key and ingest key, and leaves the desktop's key live", async () => {
      const laptop = await openSession({
        hostname: "laptop",
        sessionStartedAtMs: Date.now() - 2_000,
      });
      const desktop = await openSession({
        hostname: "desktop",
        sessionStartedAtMs: Date.now() - 1_000,
      });

      const listed = await service.listForUser({ userId: USER_ID });
      expect(
        listed.find((s) => s.sessionStartedAtMs === laptop.sessionStartedAtMs)
          ?.cliApiKeyId,
      ).toBe(laptop.loginKeyId);

      const result = await service.revokeSession({
        userId: USER_ID,
        sessionStartedAtMs: laptop.sessionStartedAtMs,
      });

      expect(result).toEqual({ revokedTokens: 2, revokedKeys: 2 });
      expect(await redisConnection!.get(laptop.accessKey)).toBeNull();
      expect(await redisConnection!.get(laptop.refreshKey)).toBeNull();
      expect(await keyState(laptop.loginKeyId)).toMatchObject({
        revocationCause: "user",
      });
      expect(await keyState(laptop.ingestKeyId)).toMatchObject({
        revocationCause: "session",
      });
      expect(
        await resolver.resolve({ token: laptop.ingestToken, projectId: null }),
      ).toBeNull();

      expect(await redisConnection!.get(desktop.accessKey)).not.toBeNull();
      expect((await keyState(desktop.loginKeyId)).revokedAt).toBeNull();
      expect(
        (
          await resolver.resolve({
            token: desktop.ingestToken,
            projectId: null,
          })
        )?.type,
      ).toBe("apiKey");
    });

    /** @scenario "Revoking every device retires every session's keys" */
    it("revoking all devices retires both login keys and both ingest keys", async () => {
      const phone = await openSession({
        hostname: "phone",
        sessionStartedAtMs: Date.now() - 500,
      });
      const live = (await service.listForUser({ userId: USER_ID })).filter(
        (s) => s.cliApiKeyId !== null,
      );
      expect(live.length).toBeGreaterThanOrEqual(2);

      const result = await service.revokeAllSessions({ userId: USER_ID });

      expect(result.revokedKeys).toBe(live.length * 2);
      expect(result.revokedTokens).toBeGreaterThanOrEqual(live.length * 2);
      expect(await service.listForUser({ userId: USER_ID })).toEqual([]);
      for (const session of live) {
        expect((await keyState(session.cliApiKeyId!)).revokedAt).not.toBeNull();
      }
      expect(await keyState(phone.ingestKeyId)).toMatchObject({
        revocationCause: "session",
      });
      expect(
        await resolver.resolve({ token: phone.ingestToken, projectId: null }),
      ).toBeNull();
    });
  });
});
