/**
 * @vitest-environment node
 *
 * Virtual-key expiry against real Postgres and the real internal auth route:
 * the date is read at resolve time, it has its own rejection code, and the
 * stored stops still win over it.
 *
 * Spec: specs/ai-gateway/virtual-key-lifecycle.feature
 */

import { createHash, createHmac } from "crypto";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { app } from "../gateway-internal";

const suffix = nanoid(8);
const ORG_ID = `org-vkex-${suffix}`;
const TEAM_ID = `team-vkex-${suffix}`;
const PROJECT_ID = `proj-vkex-${suffix}`;
const USER_ID = `usr-vkex-${suffix}`;
// gitleaks:allow (sequential-hex HMAC fixture for the signed-route test, not a credential)
const SECRET = "0123456789abcdef0123456789abcdef";

const DAY_MS = 24 * 60 * 60 * 1000;

function signedResolveKey(keyPresented: string) {
  const path = "/api/internal/gateway/resolve-key";
  const body = JSON.stringify({ key_presented: keyPresented });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `POST\n${path}\n${timestamp}\n${bodyHash}`;
  const signature = createHmac("sha256", SECRET)
    .update(canonical)
    .digest("hex");
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
  });
}

async function resolveCode(secret: string): Promise<{
  status: number;
  code: string | null;
}> {
  const res = await app.request(signedResolveKey(secret));
  const body = (await res.json()) as { error?: { code?: string } };
  return { status: res.status, code: body.error?.code ?? null };
}

describe("virtual key expiry (real PG + internal route)", () => {
  let previousSecret: string | undefined;
  const service = VirtualKeyService.create(prisma);

  beforeAll(async () => {
    await startTestContainers();
    previousSecret = process.env.LW_GATEWAY_INTERNAL_SECRET;
    process.env.LW_GATEWAY_INTERNAL_SECRET = SECRET;

    await prisma.organization.create({
      data: { id: ORG_ID, name: `VKEX Org ${suffix}`, slug: `vkex-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `VKEX Team ${suffix}`,
        slug: `vkex-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `VKEX Project ${suffix}`,
        slug: `vkex-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `vkex-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vkex.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
    if (previousSecret === undefined) {
      delete process.env.LW_GATEWAY_INTERNAL_SECRET;
    } else {
      process.env.LW_GATEWAY_INTERNAL_SECRET = previousSecret;
    }
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  async function mintKey(name: string, expiresAt?: Date) {
    return service.create({
      organizationId: ORG_ID,
      name: `${name}-${nanoid(6)}`,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      actorUserId: USER_ID,
      expiresAt: expiresAt ?? null,
    });
  }

  /** Writes a date the service would refuse, which is how a key that has
   *  already run out is set up without waiting for one to. */
  async function forceExpiry(id: string, expiresAt: Date | null) {
    await prisma.virtualKey.update({ where: { id }, data: { expiresAt } });
  }

  /** @scenario "An expired key is rejected with its own error code" */
  it("rejects an expired key with the expiry code, not revoked or disabled", async () => {
    const { virtualKey, secret } = await mintKey("ran-out");
    await forceExpiry(virtualKey.id, new Date(Date.now() - 60_000));

    expect(await resolveCode(secret)).toEqual({
      status: 403,
      code: "virtual_key_expired",
    });
  });

  /** @scenario "A key whose expiration date is still ahead serves normally" */
  it("resolves a key whose date has not arrived yet", async () => {
    const { secret } = await mintKey(
      "still-good",
      new Date(Date.now() + DAY_MS),
    );

    const res = await app.request(signedResolveKey(secret));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: string };
    expect(body.jwt).toBeTruthy();
  });

  /** @scenario "Extending the date puts an expired key back in service" */
  it("serves the same secret again once the date is moved forward", async () => {
    const { virtualKey, secret } = await mintKey("extend-me");
    await forceExpiry(virtualKey.id, new Date(Date.now() - 60_000));
    expect((await resolveCode(secret)).code).toBe("virtual_key_expired");

    await service.update({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    expect((await app.request(signedResolveKey(secret))).status).toBe(200);
  });

  /** @scenario "Clearing the expiration date makes the key permanent again" */
  it("serves forever once the date is cleared", async () => {
    const { virtualKey, secret } = await mintKey(
      "clear-me",
      new Date(Date.now() + DAY_MS),
    );
    await forceExpiry(virtualKey.id, new Date(Date.now() - 60_000));
    expect((await resolveCode(secret)).code).toBe("virtual_key_expired");

    await service.update({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      expiresAt: null,
    });

    const stored = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(stored.expiresAt).toBeNull();
    expect((await app.request(signedResolveKey(secret))).status).toBe(200);
  });

  /** @scenario "Expiry leaves disable and revoke exactly as they were" */
  it("keeps the stored status, and reports the stored stop first", async () => {
    const { virtualKey, secret } = await mintKey("still-active");
    await forceExpiry(virtualKey.id, new Date(Date.now() - 60_000));

    const expired = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(expired.status).toBe("ACTIVE");

    await service.disable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    expect((await resolveCode(secret)).code).toBe("virtual_key_disabled");

    await service.enable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    expect((await resolveCode(secret)).code).toBe("virtual_key_expired");

    await service.revoke({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    expect((await resolveCode(secret)).code).toBe("virtual_key_revoked");
  });
});
