/**
 * @vitest-environment node
 *
 * The personal-workspace branch of `POST /api/auth/cli/governance/ingestion-key`:
 * one key per session, create-only, parented to the session's CLI login key.
 * Two devices under one login each keep a working token, a session whose
 * login key is gone is refused as signed out, and the describe route reports
 * what became of a key.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */

import { IngestionKeyService } from "@ee/governance/services/ingestionKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiKeyRepository } from "~/server/api-key/api-key.repository";
import { ApiKeyService } from "~/server/api-key/api-key.service";
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
const ORG_ID = `org-ikpp-${suffix}`;
const USER_ID = `usr-ikpp-${suffix}`;
const OTHER_USER_ID = `usr-ikpp-other-${suffix}`;

let redisConnection: Redis | null = null;
let personalProjectId = "";

interface DeviceSession {
  token: string;
  loginKeyId: string;
  deviceLabel: string;
}

/**
 * A signed-in device: a login key minted the way /exchange mints it, and an
 * access token record naming it, the way the mint route reads it back.
 */
async function signIn({
  hostname,
  userId = USER_ID,
}: {
  hostname: string;
  userId?: string;
}): Promise<DeviceSession> {
  const deviceLabel = `${hostname}-${suffix}`;
  const minted = await CliLoginKeyService.create(prisma).mintForDeviceSession({
    userId,
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
  const token = `lw_at_${"p".repeat(30)}-${hostname}-${suffix}`;
  if (!redisConnection) throw new Error("Redis unavailable in test env");
  await redisConnection.set(
    `lwcli:access:${token}`,
    JSON.stringify({
      user_id: userId,
      organization_id: ORG_ID,
      issued_at: Date.now(),
      expires_at: Date.now() + 60 * 60 * 1000,
      client_info: { hostname: deviceLabel, platform: "darwin" },
      cli_api_key_id: minted.apiKeyId,
    }),
    "EX",
    60 * 60,
  );
  return { token, loginKeyId: minted.apiKeyId, deviceLabel };
}

async function mintPersonal(
  session: DeviceSession,
  sourceType: string,
): Promise<{ status: number; token: string; prefix: string }> {
  const res = await app.request("/api/auth/cli/governance/ingestion-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ source_type: sourceType }),
  });
  const json = (await res.json()) as { token: string; prefix: string };
  return { status: res.status, token: json.token, prefix: json.prefix };
}

function lookupIdOf(token: string): string {
  const match = /^ik-lw-([^_]+)_/.exec(token);
  if (!match?.[1]) throw new Error(`not an ingest token: ${token}`);
  return match[1];
}

async function keyOf(token: string) {
  return prisma.apiKey.findFirstOrThrow({
    where: { organizationId: ORG_ID, lookupId: lookupIdOf(token) },
  });
}

async function describeKey(
  session: DeviceSession,
  lookupId: string,
): Promise<{ status: string; revocation_cause?: string | null }> {
  const res = await app.request(
    `/api/auth/cli/governance/ingestion-keys/${lookupId}`,
    { headers: { Authorization: `Bearer ${session.token}` } },
  );
  if (res.status !== 200) {
    throw new Error(`describe answered ${res.status} for ${lookupId}`);
  }
  return (await res.json()) as {
    status: string;
    revocation_cause?: string | null;
  };
}

async function liveKeysFor(sourceType: string) {
  return prisma.apiKey.findMany({
    where: {
      organizationId: ORG_ID,
      ingestSourceType: sourceType,
      revokedAt: null,
      roleBindings: {
        some: { scopeType: "PROJECT", scopeId: personalProjectId },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

describe("POST /api/auth/cli/governance/ingestion-key for the personal workspace", () => {
  const resolver = TokenResolver.create(prisma);
  const service = IngestionKeyService.create(prisma);
  let laptop: DeviceSession;
  let desktop: DeviceSession;

  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });

    await prisma.organization.create({
      data: { id: ORG_ID, name: `IKPP ${suffix}`, slug: `ikpp-${suffix}` },
    });
    for (const [id, name] of [
      [USER_ID, "IKPP User"],
      [OTHER_USER_ID, "IKPP Other"],
    ] as const) {
      await prisma.user.create({
        data: { id, email: `${id}@example.com`, name },
      });
      await prisma.organizationUser.create({
        data: { organizationId: ORG_ID, userId: id, role: "ADMIN" },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: ORG_ID,
          userId: id,
          role: "ADMIN",
          scopeType: "ORGANIZATION",
          scopeId: ORG_ID,
        },
      });
    }
    const workspace = await new PersonalWorkspaceService(prisma).ensure({
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    personalProjectId = workspace.project.id;
    await new PersonalWorkspaceService(prisma).ensure({
      userId: OTHER_USER_ID,
      organizationId: ORG_ID,
    });

    laptop = await signIn({ hostname: "laptop" });
    desktop = await signIn({ hostname: "desktop" });
  }, 60_000);

  afterAll(async () => {
    if (redisConnection) {
      for (const session of [laptop, desktop]) {
        await redisConnection.del(`lwcli:access:${session.token}`);
      }
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
      .deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => undefined);
    await stopTestContainers();
  });

  describe("given a source type no wrapped tool stamps", () => {
    describe("when the CLI submits an unsupported source type", () => {
      /** @scenario "A personal key is minted only for a tool the CLI wraps" */
      it("answers 400 and mints nothing under that value", async () => {
        const made_up = await mintPersonal(laptop, "made_up");
        const other = await mintPersonal(laptop, "toString");

        expect(made_up.status).toBe(400);
        expect(other.status).toBe(400);
        expect(await liveKeysFor("made_up")).toHaveLength(0);
        expect(await liveKeysFor("toString")).toHaveLength(0);
      });
    });
  });

  describe("given a device session whose login key is live", () => {
    /** @scenario "A key minted by a CLI session is parented to that session's login key" */
    it("parents the key to the login key and stamps the login key's label", async () => {
      const minted = await mintPersonal(laptop, "claude_code");
      expect(minted.status).toBe(201);

      const key = await keyOf(minted.token);
      expect(key.parentApiKeyId).toBe(laptop.loginKeyId);
      expect(key.userId).toBe(USER_ID);

      const loginKey = await prisma.apiKey.findUniqueOrThrow({
        where: { id: laptop.loginKeyId },
        select: { createdByDeviceLabel: true },
      });
      expect(key.createdByDeviceLabel).toBe(loginKey.createdByDeviceLabel);
      expect(key.createdByDeviceLabel).toBe(laptop.deviceLabel);
    });
  });

  describe("given a laptop that already minted a personal key for a tool", () => {
    /** @scenario "Two devices each keep a live personal key for the same tool" */
    it("lets a second device mint its own key without revoking the first", async () => {
      const first = await mintPersonal(laptop, "codex");
      const second = await mintPersonal(desktop, "codex");
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.token).not.toBe(first.token);

      for (const token of [first.token, second.token]) {
        const resolved = await resolver.resolve({ token, projectId: null });
        expect(resolved?.type).toBe("apiKey");
        if (resolved?.type === "apiKey") {
          expect(resolved.project.id).toBe(personalProjectId);
        }
      }
      expect(await liveKeysFor("codex")).toHaveLength(2);
      expect((await keyOf(second.token)).parentApiKeyId).toBe(
        desktop.loginKeyId,
      );
    });
  });

  describe("given a device session whose login key was revoked", () => {
    /** @scenario "A mint from a session whose login key is revoked is refused as signed out" */
    it("answers 401 and mints nothing", async () => {
      const signedOut = await signIn({ hostname: "gone" });
      await CliLoginKeyService.create(prisma).revokeSessionKey({
        apiKeyId: signedOut.loginKeyId,
        userId: USER_ID,
        organizationId: ORG_ID,
        cause: "user",
      });
      const before = await liveKeysFor("gemini");

      const refused = await mintPersonal(signedOut, "gemini");

      expect(refused.status).toBe(401);
      expect(await liveKeysFor("gemini")).toHaveLength(before.length);
      if (redisConnection) {
        await redisConnection.del(`lwcli:access:${signedOut.token}`);
      }
    });
  });

  describe("given keys a person, a session and nothing revoked", () => {
    describe("when the CLI asks what became of a lookup id", () => {
      /** @scenario "The CLI can ask what became of its own key" */
      it("answers with the cause, live for a live key, unknown for a stranger's", async () => {
        const byPerson = await mintPersonal(laptop, "opencode");
        const bySession = await mintPersonal(laptop, "opencode");
        const live = await mintPersonal(laptop, "opencode");
        await service.revoke({
          userId: USER_ID,
          organizationId: ORG_ID,
          apiKeyId: (await keyOf(byPerson.token)).id,
        });
        await ApiKeyService.create(prisma).revoke({
          id: (await keyOf(bySession.token)).id,
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
          cause: "session",
        });

        expect(
          await describeKey(laptop, lookupIdOf(byPerson.token)),
        ).toMatchObject({ status: "revoked", revocation_cause: "user" });
        expect(
          await describeKey(laptop, lookupIdOf(bySession.token)),
        ).toMatchObject({ status: "revoked", revocation_cause: "session" });
        expect(await describeKey(laptop, lookupIdOf(live.token))).toMatchObject(
          { status: "live", revocation_cause: null },
        );
        expect(await describeKey(laptop, "nosuchlookupid00")).toEqual({
          lookup_id: "nosuchlookupid00",
          status: "unknown",
        });
      });
    });

    describe("when a session cascade writes into a key a person has just revoked", () => {
      /** @scenario "The first revocation decides the recorded cause" */
      it("keeps the person's cause, so the CLI leaves the key dead", async () => {
        const contested = await mintPersonal(laptop, "opencode");
        const key = await keyOf(contested.token);
        await service.revoke({
          userId: USER_ID,
          organizationId: ORG_ID,
          apiKeyId: key.id,
        });

        const revoked = await prisma.apiKey.findUniqueOrThrow({
          where: { id: key.id },
        });
        const revokedAt = revoked.revokedAt;
        expect(revokedAt).not.toBeNull();

        // The cascade read this key live a moment before the person's revoke
        // landed, so its write arrives at a row that is already revoked. The
        // service guard cannot close that window, because the read it guards
        // on happened first; the repository's own fence is what does.
        await ApiKeyRepository.create(prisma).revoke({
          id: key.id,
          cause: "session",
        });

        const after = await prisma.apiKey.findUniqueOrThrow({
          where: { id: key.id },
        });
        expect(after.revocationCause).toBe("user");
        // The losing write did not move the moment of death either.
        expect(after.revokedAt?.getTime()).toBe(revokedAt?.getTime());
      });
    });
  });

  describe("given a person holding two personal ingestion keys", () => {
    /** @scenario "A person revokes one of their own ingestion keys" */
    it("stops the one revoked with cause user, keeps the other, and revokes again without error", async () => {
      const doomed = await mintPersonal(laptop, "copilot_cli");
      const kept = await mintPersonal(desktop, "copilot_cli");
      const doomedKey = await keyOf(doomed.token);

      await service.revoke({
        userId: USER_ID,
        organizationId: ORG_ID,
        apiKeyId: doomedKey.id,
      });

      expect(
        await resolver.resolve({ token: doomed.token, projectId: null }),
      ).toBeNull();
      expect(
        (await resolver.resolve({ token: kept.token, projectId: null }))?.type,
      ).toBe("apiKey");
      expect((await keyOf(doomed.token)).revocationCause).toBe("user");

      await expect(
        service.revoke({
          userId: USER_ID,
          organizationId: ORG_ID,
          apiKeyId: doomedKey.id,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given another person's personal ingestion key", () => {
    /** @scenario "Revoking another person's ingestion key answers not found" */
    it("answers not found and leaves the key authorizing", async () => {
      const other = await signIn({ hostname: "other", userId: OTHER_USER_ID });
      const theirs = await mintPersonal(other, "claude_code");
      expect(theirs.status).toBe(201);
      const theirKey = await keyOf(theirs.token);

      await expect(
        service.revoke({
          userId: USER_ID,
          organizationId: ORG_ID,
          apiKeyId: theirKey.id,
        }),
      ).rejects.toMatchObject({ code: "ingestion_key_not_found" });

      expect(
        (await resolver.resolve({ token: theirs.token, projectId: null }))
          ?.type,
      ).toBe("apiKey");
      if (redisConnection) {
        await redisConnection.del(`lwcli:access:${other.token}`);
      }
    });
  });
});
