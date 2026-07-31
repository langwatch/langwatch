/**
 * @vitest-environment node
 *
 * Reversible virtual-key disable and enable against real Postgres and the
 * real internal auth route: the state machine (grace preservation, revoke
 * terminality) and the distinct rejection a disabled key's traffic gets.
 *
 * Spec: specs/ai-gateway/virtual-key-lifecycle.feature
 */

import { TRPCError } from "@trpc/server";
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
const ORG_ID = `org-vklc-${suffix}`;
const TEAM_ID = `team-vklc-${suffix}`;
const PROJECT_ID = `proj-vklc-${suffix}`;
const USER_ID = `usr-vklc-${suffix}`;
// gitleaks:allow — sequential-hex HMAC fixture for the signed-route test, not a credential
const SECRET = "0123456789abcdef0123456789abcdef";

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

describe("virtual key disable and enable (real PG + internal route)", () => {
  let previousSecret: string | undefined;
  const service = VirtualKeyService.create(prisma);

  beforeAll(async () => {
    await startTestContainers();
    previousSecret = process.env.LW_GATEWAY_INTERNAL_SECRET;
    process.env.LW_GATEWAY_INTERNAL_SECRET = SECRET;

    await prisma.organization.create({
      data: { id: ORG_ID, name: `VKLC Org ${suffix}`, slug: `vklc-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `VKLC Team ${suffix}`,
        slug: `vklc-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `VKLC Project ${suffix}`,
        slug: `vklc-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `vklc-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vklc.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
    if (previousSecret === undefined) {
      delete process.env.LW_GATEWAY_INTERNAL_SECRET;
    } else {
      process.env.LW_GATEWAY_INTERNAL_SECRET = previousSecret;
    }
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  async function mintKey(name: string) {
    return service.create({
      organizationId: ORG_ID,
      name,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      actorUserId: USER_ID,
      budget: { limitUsd: "100", window: "MONTH", onBreach: "BLOCK" },
    });
  }

  /** @scenario Disable preserves everything and enable restores it exactly */
  it("keeps rotation grace and budgets across a disable and enable round trip", async () => {
    const { virtualKey } = await mintKey("round-trip");
    await service.rotate({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    const rotated = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(rotated.previousHashedSecret).not.toBeNull();
    expect(rotated.previousSecretValidUntil).not.toBeNull();

    await service.disable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      reason: "billing hold",
    });
    const disabled = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(disabled.status).toBe("DISABLED");
    expect(disabled.disabledReason).toBe("billing hold");
    expect(disabled.previousHashedSecret).toBe(rotated.previousHashedSecret);
    expect(disabled.previousSecretValidUntil?.getTime()).toBe(
      rotated.previousSecretValidUntil?.getTime(),
    );

    const budgetsWhileDisabled = await prisma.gatewayBudget.findMany({
      where: {
        organizationId: ORG_ID,
        scopeType: "VIRTUAL_KEY",
        scopeId: virtualKey.id,
        archivedAt: null,
      },
    });
    expect(budgetsWhileDisabled).toHaveLength(1);

    await service.enable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    const enabled = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(enabled.status).toBe("ACTIVE");
    expect(enabled.disabledAt).toBeNull();
    expect(enabled.disabledReason).toBeNull();
    expect(enabled.previousHashedSecret).toBe(rotated.previousHashedSecret);
  });

  /** @scenario A disabled key is rejected with its own error code */
  it("rejects a disabled key's traffic with the disabled code, not a bad credential", async () => {
    const { virtualKey, secret } = await mintKey("suspended-tenant");
    await service.disable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });

    const res = await app.request(signedResolveKey(secret));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("virtual_key_disabled");
  });

  /** @scenario Revocation is terminal in both directions */
  it("refuses to disable or enable a revoked key", async () => {
    const { virtualKey } = await mintKey("terminal");
    await service.revoke({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    await expect(
      service.disable({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    await expect(
      service.enable({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
