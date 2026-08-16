/**
 * @vitest-environment node
 *
 * The record of open realtime voice sessions, against real Postgres: the cap
 * that bounds how many voice calls one key runs at once, the lock that makes
 * it a cap under concurrency, the expiry that stops a session nobody reported
 * from holding a slot forever, and the match that refuses to guess which call
 * a vendor report belongs to.
 *
 * Spec: specs/ai-gateway/realtime-sessions.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  correlateRealtimeSession,
  expireStaleRealtimeSessions,
  matchRealtimeSession,
  REALTIME_OPEN_SESSION_WINDOW_MS,
  releaseRealtimeSession,
  reserveRealtimeSession,
} from "../realtimeSession.service";

const suffix = nanoid(8);
const ORG_ID = `org-rt-${suffix}`;
const TEAM_ID = `team-rt-${suffix}`;
const PROJECT_ID = `project-rt-${suffix}`;
const USER_ID = `user-rt-${suffix}`;
const PROVIDER_ID = `mp-rt-${suffix}`;

/** A key with a cap of `max`, or no cap when it is null. */
async function keyWithCap(id: string, max: number | null): Promise<string> {
  await prisma.virtualKey.create({
    data: {
      id,
      organizationId: ORG_ID,
      name: id,
      hashedSecret: `hash-${id}`,
      displayPrefix: "vk-lw-xxxxxxx",
      createdById: USER_ID,
      traceProjectId: PROJECT_ID,
      config: { realtime: { maxOpenSessions: max } },
      scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
    },
  });
  return id;
}

function reservation(virtualKeyId: string, sessionId: string) {
  return {
    sessionId,
    projectId: PROJECT_ID,
    organizationId: ORG_ID,
    virtualKeyId,
    modelProviderId: PROVIDER_ID,
    vendor: "elevenlabs",
    model: "convai",
  };
}

describe("given a virtual key that brokers realtime voice sessions", () => {
  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${suffix}`,
        slug: TEAM_ID,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${PROJECT_ID}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@acme.test`, name: USER_ID },
    });
  });

  afterAll(async () => {
    await prisma.gatewayRealtimeSession.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  });

  beforeEach(async () => {
    await prisma.gatewayRealtimeSession.deleteMany({
      where: { organizationId: ORG_ID },
    });
  });

  it("admits up to the cap and refuses the mint past it", async () => {
    const vk = await keyWithCap(`vk-cap-${nanoid(6)}`, 1);

    expect(await reserveRealtimeSession(reservation(vk, `s1-${nanoid(6)}`))).toEqual({
      ok: true,
    });

    const refused = await reserveRealtimeSession(reservation(vk, `s2-${nanoid(6)}`));
    expect(refused).toEqual({ ok: false, reason: "session_limit", open: 1, limit: 1 });

    // The refusal must not have booked anything, or the key would lose a slot
    // every time it was told it had none.
    expect(
      await prisma.gatewayRealtimeSession.count({
        where: { organizationId: ORG_ID, virtualKeyId: vk },
      }),
    ).toBe(1);
  });

  it("frees the slot when the session closes", async () => {
    const vk = await keyWithCap(`vk-free-${nanoid(6)}`, 1);
    const first = `s1-${nanoid(6)}`;
    await reserveRealtimeSession(reservation(vk, first));

    await releaseRealtimeSession({
      sessionId: first,
      projectId: PROJECT_ID,
      status: "FAILED",
      reason: "the mint never produced a credential",
    });

    expect(await reserveRealtimeSession(reservation(vk, `s2-${nanoid(6)}`))).toEqual({
      ok: true,
    });
  });

  it("lets exactly one of two simultaneous mints take the last slot", async () => {
    const vk = await keyWithCap(`vk-race-${nanoid(6)}`, 1);

    // Without the advisory lock both read a count of zero before either
    // insert lands, and a key limited to one holds two calls.
    const outcomes = await Promise.all([
      reserveRealtimeSession(reservation(vk, `a-${nanoid(6)}`)),
      reserveRealtimeSession(reservation(vk, `b-${nanoid(6)}`)),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);
  });

  it("does not count a session older than the longest possible call", async () => {
    const vk = await keyWithCap(`vk-stale-${nanoid(6)}`, 1);
    const stale = `stale-${nanoid(6)}`;
    await reserveRealtimeSession(reservation(vk, stale));
    await prisma.gatewayRealtimeSession.update({
      where: { id: stale },
      data: {
        mintedAt: new Date(Date.now() - REALTIME_OPEN_SESSION_WINDOW_MS - 60_000),
      },
    });

    // An OpenAI socket never signals that it closed, so without this a key
    // ratchets down one slot at a time until it can mint nothing.
    expect(await reserveRealtimeSession(reservation(vk, `fresh-${nanoid(6)}`))).toEqual({
      ok: true,
    });
    const expired = await prisma.gatewayRealtimeSession.findUnique({
      where: { id: stale },
    });
    expect(expired?.status).toBe("EXPIRED");
  });

  it("counts every open session when the key has no cap", async () => {
    const vk = await keyWithCap(`vk-nocap-${nanoid(6)}`, null);
    for (let i = 0; i < 3; i++) {
      expect(await reserveRealtimeSession(reservation(vk, `n${i}-${nanoid(6)}`))).toEqual({
        ok: true,
      });
    }
  });

  it("matches a vendor report by the conversation id recorded at the mint", async () => {
    const vk = await keyWithCap(`vk-match-${nanoid(6)}`, null);
    const sessionId = `m-${nanoid(6)}`;
    await reserveRealtimeSession(reservation(vk, sessionId));
    expect(
      await correlateRealtimeSession({
        sessionId,
        projectId: PROJECT_ID,
        vendorConversationId: "conv_exact",
      }),
    ).toBe(true);

    const matched = await matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: ORG_ID,
      modelProviderId: PROVIDER_ID,
      vendorConversationId: "conv_exact",
    });
    expect(matched?.id).toBe(sessionId);
  });

  it("matches on the session id a conversation echoed back when no conversation id was recorded", async () => {
    const vk = await keyWithCap(`vk-echo-${nanoid(6)}`, null);
    const sessionId = `e-${nanoid(6)}`;
    await reserveRealtimeSession(reservation(vk, sessionId));

    const matched = await matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: ORG_ID,
      modelProviderId: PROVIDER_ID,
      echoedSessionId: sessionId,
    });
    expect(matched?.id).toBe(sessionId);
  });

  it("refuses to guess when two sessions are open in the same window", async () => {
    const vk = await keyWithCap(`vk-two-${nanoid(6)}`, null);
    await reserveRealtimeSession(reservation(vk, `x-${nanoid(6)}`));
    await reserveRealtimeSession(reservation(vk, `y-${nanoid(6)}`));

    // Charging a call to the wrong session is a wrong bill that looks right.
    // An unmatched call settles visibly as cost unknown instead.
    const matched = await matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: ORG_ID,
      modelProviderId: PROVIDER_ID,
    });
    expect(matched).toBeNull();
  });

  it("never matches a report to another organization's session", async () => {
    const vk = await keyWithCap(`vk-tenant-${nanoid(6)}`, null);
    const sessionId = `t-${nanoid(6)}`;
    await reserveRealtimeSession(reservation(vk, sessionId));
    await correlateRealtimeSession({
      sessionId,
      projectId: PROJECT_ID,
      vendorConversationId: "conv_tenant",
    });

    // A conversation id is the vendor's, not ours, so the lookup is scoped to
    // the organization that owns the credential the delivery was signed for.
    const matched = await matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: `${ORG_ID}-other`,
      modelProviderId: PROVIDER_ID,
      vendorConversationId: "conv_tenant",
    });
    expect(matched).toBeNull();
  });

  it("expires only the sessions that outlived the longest possible call", async () => {
    const vk = await keyWithCap(`vk-sweep-${nanoid(6)}`, null);
    const old = `old-${nanoid(6)}`;
    const fresh = `fresh-${nanoid(6)}`;
    await reserveRealtimeSession(reservation(vk, old));
    await reserveRealtimeSession(reservation(vk, fresh));
    await prisma.gatewayRealtimeSession.update({
      where: { id: old },
      data: {
        mintedAt: new Date(Date.now() - REALTIME_OPEN_SESSION_WINDOW_MS - 1000),
      },
    });

    await expireStaleRealtimeSessions({ virtualKeyId: vk });

    expect((await prisma.gatewayRealtimeSession.findUnique({ where: { id: old } }))?.status)
      .toBe("EXPIRED");
    expect((await prisma.gatewayRealtimeSession.findUnique({ where: { id: fresh } }))?.status)
      .toBe("OPEN");
  });
});
