/**
 * @vitest-environment node
 * Real Postgres. The cap bounding concurrent voice calls per key, the lock making it a cap under concurrency, the expiry freeing an unreported session's slot, and the match refusing to guess. Spec: specs/ai-gateway/realtime-sessions.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { ModelCatalogGatewaySpendRatingAdapter } from "../adapters/model-catalog.gateway-spend-rating.adapter";
import { GatewaySpanIngestionPort } from "../ports/gateway-span-ingestion.port";
import { GatewaySpendConfirmationPort } from "../ports/gateway-spend-confirmation.port";
import type { ConfirmSpendCommandData } from "../processes/gateway-spend-commands.process";
import {
  GatewayRealtimeSessionService,
  REALTIME_OPEN_SESSION_WINDOW_MS,
  type GatewayRealtimeSessionCollaborators,
} from "../services/gateway-realtime-session.service";

const realtimeSessions = GatewayRealtimeSessionService.create();
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

/**
 * Spend pipeline and trace collector are recorded, not run, so a
 * settlement's two writes can be asserted independently; this file's
 * subject is the session record that produces both.
 */
const sentConfirmations: ConfirmSpendCommandData[] = [];
const ingestedSpans: Record<string, any>[] = [];

class RecordingSpendConfirmation extends GatewaySpendConfirmationPort {
  async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    sentConfirmations.push(data);
  }
}

class RecordingSpanIngestion extends GatewaySpanIngestionPort {
  async ingestNormalizedSpan(input: any): Promise<void> {
    ingestedSpans.push(input);
  }
}

const collaborators: GatewayRealtimeSessionCollaborators = {
  get database() {
    return prisma;
  },
  spendRating: ModelCatalogGatewaySpendRatingAdapter.create(),
  spendConfirmation: new RecordingSpendConfirmation(),
  spanIngestion: new RecordingSpanIngestion(),
};

/** The value of one span attribute, whichever shape it was written in. */
function spanAttr(span: Record<string, any>, key: string): unknown {
  const found = (span.span.attributes as Record<string, any>[]).find((a) => a.key === key);
  return found?.value?.doubleValue ?? found?.value?.stringValue;
}

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

function reservation(virtualKeyId: string, sessionId: string, traceId?: string) {
  return {
    sessionId,
    projectId: PROJECT_ID,
    organizationId: ORG_ID,
    virtualKeyId,
    modelProviderId: PROVIDER_ID,
    vendor: "elevenlabs",
    model: "convai",
    // The caller asked for the provider-prefixed alias, which is what the
    // mint's span recorded; the billing id resolved to "convai".
    requestedModel: "elevenlabs/convai",
    ...(traceId === undefined ? {} : { traceId }),
    collaborators,
  };
}

describe.skipIf(!databaseUrl)("given a virtual key that brokers realtime voice sessions", () => {
  beforeAll(async () => {
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
    if (!databaseUrl) return;
    await prisma.gatewayRealtimeSession.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.gatewayRealtimeSession.deleteMany({
      where: { organizationId: ORG_ID },
    });
    sentConfirmations.length = 0;
    ingestedSpans.length = 0;
  });

  /** @scenario "A post-call report closes the session and confirms its spend" */
  it("closes the session and confirms its spend from the report", async () => {
    const vk = await keyWithCap(`vk-confirm-${nanoid(6)}`, null);
    const sessionId = `c-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, sessionId));
    const session = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    await realtimeSessions.closeAndConfirmRealtimeSession({
      session,
      // The vendor prices a conversation by duration and reports whole
      // seconds; every quantity on the spend wire is an integer, so the one
      // conversion to milliseconds happens at this seam.
      usage: { audio_ms: 3000 },
      vendorCostRaw: { call_duration_secs: 3, cost: 24 },
      durationMs: 3000,
      reason: "post-call report",
      collaborators,
    });

    const closed = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closeReason).toBe("post-call report");
    expect(closed.vendorCostRaw).toEqual({ call_duration_secs: 3, cost: 24 });

    expect(sentConfirmations).toHaveLength(1);
    expect(sentConfirmations[0]).toMatchObject({
      gateway_request_id: sessionId,
      tenantId: PROJECT_ID,
      model: "convai",
      model_provider_id: PROVIDER_ID,
      usage: expect.objectContaining({ audio_ms: 3000 }),
    });
    // The vendor's own figure is kept for reconciliation and never billed
    // from: two systems pricing the same call is how they disagree about it.
    expect(sentConfirmations[0]!.cost_nano_usd).toBeGreaterThan(0);
  });

  /** @scenario "A report arriving after the session closed still confirms it" */
  it("still confirms a session the expiry sweep already closed", async () => {
    const vk = await keyWithCap(`vk-late-${nanoid(6)}`, null);
    const sessionId = `l-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, sessionId));
    await realtimeSessions.releaseRealtimeSession({
      sessionId,
      projectId: PROJECT_ID,
      status: "EXPIRED",
      reason: "no vendor report arrived within the longest possible call",
      collaborators,
    });
    const session = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    await realtimeSessions.closeAndConfirmRealtimeSession({
      session,
      usage: { audio_ms: 5000 },
      durationMs: 5000,
      reason: "post-call report",
      collaborators,
    });

    // Returning early here would drop the charge for a call that really
    // happened, just because a sweep got there first.
    expect(sentConfirmations).toHaveLength(1);
    expect(
      (
        await prisma.gatewayRealtimeSession.findUniqueOrThrow({
          where: { id: sessionId },
        })
      ).status,
    ).toBe("CLOSED");
  });

  /** @scenario "A settled session is written into the trace it was minted in" */
  it("writes the call's cost and quantities into the mint's trace", async () => {
    const vk = await keyWithCap(`vk-span-${nanoid(6)}`, null);
    const sessionId = `sp-${nanoid(6)}`;
    const traceId = `trace-${nanoid(10)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, sessionId, traceId));
    const session = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    await realtimeSessions.closeAndConfirmRealtimeSession({
      session,
      usage: { audio_ms: 6000 },
      durationMs: 6000,
      reason: "post-call report",
      collaborators,
    });

    expect(ingestedSpans).toHaveLength(1);
    const written = ingestedSpans[0]!;
    expect(written.tenantId).toBe(PROJECT_ID);
    // Same trace as the mint, so the call is one trace rather than two.
    expect(written.span.traceId).toBe(traceId);

    // The cost on the trace is the same figure the spend record carries,
    // rated once from the same quantities. Two surfaces pricing one call
    // separately is how they come to disagree about it.
    const confirmedNanoUsd = sentConfirmations[0]!.cost_nano_usd;
    expect(confirmedNanoUsd).toBeGreaterThan(0);
    expect(spanAttr(written, "langwatch.span.cost")).toBeCloseTo(
      confirmedNanoUsd / 1_000_000_000,
      12,
    );
    expect(spanAttr(written, "langwatch.virtual_key_id")).toBe(vk);
    expect(spanAttr(written, "gen_ai.usage.audio_seconds")).toBe(6);
    expect(spanAttr(written, "gen_ai.provider.name")).toBe("elevenlabs");
    // The mint's model, not the billing id: two names for one call would put
    // the cost under a model the trace never mentions.
    expect(spanAttr(written, "gen_ai.request.model")).toBe("elevenlabs/convai");
  });

  /** @scenario "A settlement delivered twice is written into the trace once" */
  it("writes nothing more when the same settlement is delivered again", async () => {
    const vk = await keyWithCap(`vk-replay-${nanoid(6)}`, null);
    const sessionId = `rp-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(
      reservation(vk, sessionId, `trace-${nanoid(10)}`),
    );
    const session = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    await realtimeSessions.closeAndConfirmRealtimeSession({
      session,
      usage: { audio_ms: 6000 },
      durationMs: 6000,
      reason: "post-call report",
      collaborators,
    });
    // The same row the first delivery read: a resent webhook carries no
    // knowledge that the session has since closed.
    await realtimeSessions.closeAndConfirmRealtimeSession({
      session,
      usage: { audio_ms: 6000 },
      durationMs: 6000,
      reason: "post-call report, resent",
      collaborators,
    });

    // The trace shows one call at one cost. The spend pipeline collapses the
    // second confirmation by its own per-step key; the trace has no such
    // gate, so the close is what makes this exactly once.
    expect(ingestedSpans).toHaveLength(1);
  });

  /** @scenario "A session minted without a trace writes no span" */
  it("confirms the spend and writes no span when the mint had no trace", async () => {
    const vk = await keyWithCap(`vk-notrace-${nanoid(6)}`, null);
    const sessionId = `nt-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, sessionId));
    const session = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    await realtimeSessions.closeAndConfirmRealtimeSession({
      session,
      usage: { audio_ms: 3000 },
      durationMs: 3000,
      reason: "post-call report",
      collaborators,
    });

    // The money still lands. Only the trace surface is missing, because
    // there is no trace to write it into.
    expect(sentConfirmations).toHaveLength(1);
    expect(ingestedSpans).toHaveLength(0);
  });

  /** @scenario "A mint past the cap is refused and books nothing" */
  it("refuses the mint past the cap and books nothing", async () => {
    const vk = await keyWithCap(`vk-cap-${nanoid(6)}`, 1);

    expect(
      await realtimeSessions.reserveRealtimeSession(reservation(vk, `s1-${nanoid(6)}`)),
    ).toEqual({
      ok: true,
    });

    const refused = await realtimeSessions.reserveRealtimeSession(
      reservation(vk, `s2-${nanoid(6)}`),
    );
    expect(refused).toEqual({
      ok: false,
      reason: "session_limit",
      open: 1,
      limit: 1,
    });

    // The refusal must not have booked anything, or the key would lose a slot
    // every time it was told it had none.
    expect(
      await prisma.gatewayRealtimeSession.count({
        where: { organizationId: ORG_ID, virtualKeyId: vk },
      }),
    ).toBe(1);
  });

  /** @scenario "Closing a session frees its slot" */
  it("frees the slot when the session closes", async () => {
    const vk = await keyWithCap(`vk-free-${nanoid(6)}`, 1);
    const first = `s1-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, first));

    await realtimeSessions.releaseRealtimeSession({
      sessionId: first,
      projectId: PROJECT_ID,
      status: "FAILED",
      reason: "the mint never produced a credential",
      collaborators,
    });

    expect(
      await realtimeSessions.reserveRealtimeSession(reservation(vk, `s2-${nanoid(6)}`)),
    ).toEqual({
      ok: true,
    });
  });

  /** @scenario "Two mints racing on one key cannot both take the last slot" */
  it("lets exactly one of two simultaneous mints take the last slot", async () => {
    const vk = await keyWithCap(`vk-race-${nanoid(6)}`, 1);

    // Without the advisory lock both read a count of zero before either
    // insert lands, and a key limited to one holds two calls.
    const outcomes = await Promise.all([
      realtimeSessions.reserveRealtimeSession(reservation(vk, `a-${nanoid(6)}`)),
      realtimeSessions.reserveRealtimeSession(reservation(vk, `b-${nanoid(6)}`)),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);
  });

  /** @scenario "A session that outlived the longest possible call stops holding a slot" */
  it("does not count a session older than the longest possible call", async () => {
    const vk = await keyWithCap(`vk-stale-${nanoid(6)}`, 1);
    const stale = `stale-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, stale));
    await prisma.gatewayRealtimeSession.update({
      where: { id: stale },
      data: {
        mintedAt: new Date(Date.now() - REALTIME_OPEN_SESSION_WINDOW_MS - 60_000),
      },
    });

    // An OpenAI socket never signals that it closed, so without this a key
    // ratchets down one slot at a time until it can mint nothing.
    expect(
      await realtimeSessions.reserveRealtimeSession(reservation(vk, `fresh-${nanoid(6)}`)),
    ).toEqual({
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
      expect(
        await realtimeSessions.reserveRealtimeSession(reservation(vk, `n${i}-${nanoid(6)}`)),
      ).toEqual({
        ok: true,
      });
    }
  });

  /** @scenario "The conversation id recorded at the mint is the join key" */
  it("matches a vendor report by the conversation id recorded at the mint", async () => {
    const vk = await keyWithCap(`vk-match-${nanoid(6)}`, null);
    const sessionId = `m-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, sessionId));
    expect(
      await realtimeSessions.correlateRealtimeSession({
        sessionId,
        projectId: PROJECT_ID,
        vendorConversationId: "conv_exact",
        collaborators,
      }),
    ).toBe(true);

    const matched = await realtimeSessions.matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: ORG_ID,
      modelProviderId: PROVIDER_ID,
      vendorConversationId: "conv_exact",
      collaborators,
    });
    expect(matched?.id).toBe(sessionId);
  });

  it("matches on the session id a conversation echoed back when no conversation id was recorded", async () => {
    const vk = await keyWithCap(`vk-echo-${nanoid(6)}`, null);
    const sessionId = `e-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, sessionId));

    const matched = await realtimeSessions.matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: ORG_ID,
      modelProviderId: PROVIDER_ID,
      echoedSessionId: sessionId,
      collaborators,
    });
    expect(matched?.id).toBe(sessionId);
  });

  /** @scenario "Two candidate sessions is a miss, not a guess" */
  it("refuses to guess when two sessions are open in the same window", async () => {
    const vk = await keyWithCap(`vk-two-${nanoid(6)}`, null);
    await realtimeSessions.reserveRealtimeSession(reservation(vk, `x-${nanoid(6)}`));
    await realtimeSessions.reserveRealtimeSession(reservation(vk, `y-${nanoid(6)}`));

    // Charging a call to the wrong session is a wrong bill that looks right.
    // An unmatched call settles visibly as cost unknown instead.
    const matched = await realtimeSessions.matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: ORG_ID,
      modelProviderId: PROVIDER_ID,
      collaborators,
    });
    expect(matched).toBeNull();
  });

  /** @scenario "A report never matches another organization's session" */
  it("never matches a report to another organization's session", async () => {
    const vk = await keyWithCap(`vk-tenant-${nanoid(6)}`, null);
    const sessionId = `t-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, sessionId));
    await realtimeSessions.correlateRealtimeSession({
      sessionId,
      projectId: PROJECT_ID,
      vendorConversationId: "conv_tenant",
      collaborators,
    });

    // A conversation id is the vendor's, not ours, so the lookup is scoped to
    // the organization that owns the credential the delivery was signed for.
    const matched = await realtimeSessions.matchRealtimeSession({
      vendor: "elevenlabs",
      organizationId: `${ORG_ID}-other`,
      modelProviderId: PROVIDER_ID,
      vendorConversationId: "conv_tenant",
      collaborators,
    });
    expect(matched).toBeNull();
  });

  it("expires only the sessions that outlived the longest possible call", async () => {
    const vk = await keyWithCap(`vk-sweep-${nanoid(6)}`, null);
    const old = `old-${nanoid(6)}`;
    const fresh = `fresh-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(reservation(vk, old));
    await realtimeSessions.reserveRealtimeSession(reservation(vk, fresh));
    await prisma.gatewayRealtimeSession.update({
      where: { id: old },
      data: {
        mintedAt: new Date(Date.now() - REALTIME_OPEN_SESSION_WINDOW_MS - 1000),
      },
    });

    await realtimeSessions.expireStaleRealtimeSessions({ virtualKeyId: vk, collaborators });

    expect((await prisma.gatewayRealtimeSession.findUnique({ where: { id: old } }))?.status).toBe(
      "EXPIRED",
    );
    expect((await prisma.gatewayRealtimeSession.findUnique({ where: { id: fresh } }))?.status).toBe(
      "OPEN",
    );
  });

  describe("when a usage report arrives from a different key in the same project", () => {
    /** @scenario "A usage report from another key in the same project is refused" */
    it("refuses the report and leaves the session open", async () => {
      const opener = await keyWithCap(`vk-opener-${nanoid(6)}`, null);
      const other = await keyWithCap(`vk-other-${nanoid(6)}`, null);
      const sessionId = `sess-xkey-${nanoid(6)}`;
      await realtimeSessions.reserveRealtimeSession(reservation(opener, sessionId));

      // Both keys are scoped to the same trace project, which is the normal
      // shape: a project's keys share its destination. The session id is a
      // gateway request id, which the opener's own response header carries,
      // so it is not a secret.
      const stolen = await realtimeSessions.reportRealtimeSessionUsage({
        sessionId,
        projectId: PROJECT_ID,
        virtualKeyId: other,
        usage: { input_tokens: 999_999 },
        collaborators,
      });
      expect(stolen).toBe("not_found");
      expect(sentConfirmations).toHaveLength(0);
      expect(
        (
          await prisma.gatewayRealtimeSession.findUnique({
            where: { id: sessionId },
          })
        )?.status,
      ).toBe("OPEN");

      // The key that opened it still closes it.
      const own = await realtimeSessions.reportRealtimeSessionUsage({
        sessionId,
        projectId: PROJECT_ID,
        virtualKeyId: opener,
        usage: { input_tokens: 10, output_tokens: 5 },
        collaborators,
      });
      expect(own).toBe("closed");
      expect(sentConfirmations).toHaveLength(1);
    });
  });
});
