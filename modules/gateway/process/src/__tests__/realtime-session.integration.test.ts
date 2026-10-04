/**
 * @vitest-environment node
 * Real Postgres: the concurrency cap's lock, expiry freeing a slot, match refusing to guess.
 * Real ClickHouse: each usage report debiting every budget on the key's chain.
 * Spec: specs/ai-gateway/realtime-sessions.feature
 */
import type { SpendUsage } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate, nowInstant, toDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGatewayTestPrismaConnection } from "../app/__tests__/gateway-prisma.fixture.ts";
import { PrismaGatewayAdapter } from "../app/gateway-composition.build.ts";
import type {
  GatewayChangeEvents,
  GatewaySpanIngestion,
  GatewaySpendConfirmation,
} from "../app/gateway.members.ts";
import { MemoryElevenLabsConversationChannel } from "../channels/memory/memory.elevenlabs-conversation.channel.ts";
import { writeGatewayDebitsSchema } from "../eventing/gateway-debit.intent.ts";
import type { ConfirmSpendCommandData } from "../eventing/gateway-spend-commands.process.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository.ts";
import { GatewayBudgetChangeDedupeRepository } from "../repositories/gateway-budget-change-dedupe.repository.ts";
import { PrismaGatewayRealtimeSessionRepository } from "../repositories/prisma/prisma.gateway-realtime-session.repository.ts";
import { EMPTY_SPEND_USAGE } from "../rules/gateway-spend-projection.rules.ts";
import { GatewayBudgetChangeDedupeService } from "../services/gateway-budget-change-dedupe.service.ts";
import type { GatewayBudgetCrossingService } from "../services/gateway-budget-crossing.service.ts";
import { GatewayElevenLabsCredentialService } from "../services/gateway-elevenlabs-credential.service.ts";
import { GatewayRealtimeSessionMeteringService } from "../services/gateway-realtime-session-metering.service.ts";
import {
  GatewayRealtimeSessionReconciliationService,
  realtimeSessionReconciliationConfig,
} from "../services/gateway-realtime-session-reconciliation.service.ts";
import { GatewayRealtimeSessionSweepService } from "../services/gateway-realtime-session-sweep.service.ts";
import {
  GatewayRealtimeSessionService,
  REALTIME_OPEN_SESSION_WINDOW_MS,
  type GatewayRealtimeSessionCollaborators,
} from "../services/gateway-realtime-session.service.ts";
import { GatewaySpendDebitService } from "../services/gateway-spend-debit.service.ts";
import type { GatewayService } from "../services/gateway.service.ts";
import { ModelCatalogGatewaySpendRatingService } from "../services/model-catalog-gateway-spend-rating.service.ts";
import { organizationApiOver } from "./support/prisma-organization-api.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

/** The stored row, as the settlement seam reads it: the same columns, on instants. */
function toSessionRecord<
  Row extends { mintedAt: Date; credentialExpiresAt: Date | null; lastReportAt: Date | null },
>(row: Row) {
  return {
    ...row,
    mintedAt: fromDate(row.mintedAt),
    credentialExpiresAt: row.credentialExpiresAt ? fromDate(row.credentialExpiresAt) : null,
    lastReportAt: row.lastReportAt ? fromDate(row.lastReportAt) : null,
  };
}

const realtimeSessions = GatewayRealtimeSessionService.create();
const metering = GatewayRealtimeSessionMeteringService.create();

const databaseUrl = process.env.DATABASE_URL;
const chUrl = testClickHouseUrl();
const connection = databaseUrl ? createGatewayTestPrismaConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

/**
 * Spend pipeline and trace collector are recorded, not run, so a
 * settlement's two writes can be asserted independently; this file's
 * subject is the session record that produces both.
 */
const sentConfirmations: ConfirmSpendCommandData[] = [];
const ingestedSpans: Record<string, any>[] = [];

class RecordingSpendConfirmation implements GatewaySpendConfirmation {
  async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    sentConfirmations.push(data);
  }
}

class RecordingSpanIngestion implements GatewaySpanIngestion {
  async ingestNormalizedSpan(input: any): Promise<void> {
    ingestedSpans.push(input);
  }
}

const collaborators: GatewayRealtimeSessionCollaborators = {
  sessions: PrismaGatewayRealtimeSessionRepository.create({
    get database() {
      return prisma;
    },
  }),
  spendRating: ModelCatalogGatewaySpendRatingService.create(),
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
    await prisma.gatewayRealtimeSessionReport.deleteMany({ where: { projectId: PROJECT_ID } });
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
      session: toSessionRecord(session),
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
      session: toSessionRecord(session),
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
      session: toSessionRecord(session),
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
      session: toSessionRecord(session),
      usage: { audio_ms: 6000 },
      durationMs: 6000,
      reason: "post-call report",
      collaborators,
    });
    // The same row the first delivery read: a resent webhook carries no
    // knowledge that the session has since closed.
    await realtimeSessions.closeAndConfirmRealtimeSession({
      session: toSessionRecord(session),
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

  /** @scenario "Two settlements arriving together write one span" */
  it("writes no span for a settlement that waited on the row while another closed it", async () => {
    const vk = await keyWithCap(`vk-overlap-${nanoid(6)}`, null);
    const sessionId = `ov-${nanoid(6)}`;
    await realtimeSessions.reserveRealtimeSession(
      reservation(vk, sessionId, `trace-${nanoid(10)}`),
    );
    const session = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    await raceOnOneRow<string>({
      prisma,
      table: "GatewayRealtimeSession",
      first: async (tx) => {
        await tx.gatewayRealtimeSession.updateMany({
          where: { id: sessionId, projectId: PROJECT_ID },
          data: { status: "CLOSED", closedAt: new Date(), closeReason: "first report" },
        });
        return "closed";
      },
      second: async () => {
        await realtimeSessions.closeAndConfirmRealtimeSession({
          session: toSessionRecord(session),
          usage: { audio_ms: 4000 },
          durationMs: 4000,
          reason: "second report",
          collaborators,
        });
        return "reported";
      },
    });

    const row = await prisma.gatewayRealtimeSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(row.status).toBe("CLOSED");
    expect(row.closeReason).toBe("first report");
    expect(ingestedSpans).toHaveLength(0);
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
      session: toSessionRecord(session),
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
        mintedAt: toDate(
          nowInstant().subtract({ milliseconds: REALTIME_OPEN_SESSION_WINDOW_MS + 60_000 }),
        ),
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

    const matched = await realtimeSessions.findMatchingRealtimeSession({
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

    const matched = await realtimeSessions.findMatchingRealtimeSession({
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
    const matched = await realtimeSessions.findMatchingRealtimeSession({
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
    const matched = await realtimeSessions.findMatchingRealtimeSession({
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
        mintedAt: toDate(
          nowInstant().subtract({ milliseconds: REALTIME_OPEN_SESSION_WINDOW_MS + 1000 }),
        ),
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
      const stolen = await metering.reportRealtimeSessionUsage({
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
      const own = await metering.reportRealtimeSessionUsage({
        sessionId,
        projectId: PROJECT_ID,
        virtualKeyId: opener,
        usage: { input_tokens: 10, output_tokens: 5 },
        collaborators,
      });
      expect(own).toMatchObject({ status: "closed" });
      expect(sentConfirmations).toHaveLength(1);
    });
  });
});

// ── usage reports against real budgets ────────────────────────────────────

const METERED_ORG_ID = `org-rtm-${suffix}`;
const METERED_TEAM_ID = `team-rtm-${suffix}`;
const METERED_USER_ID = `user-rtm-${suffix}`;
const REALTIME_MODEL = "openai/gpt-realtime-1.5";
const rating = ModelCatalogGatewaySpendRatingService.create();

/** Output audio tokens that cost one US dollar on the realtime model. */
const TOKENS_PER_USD = 15_625;
const USD = 1_000_000_000;

function usd(dollars: number): Partial<SpendUsage> {
  return { output_audio_tokens: dollars * TOKENS_PER_USD };
}

let chRepo: GatewayBudgetClickHouseRepository;
let budgetService: GatewayService;
const meteredProjectIds: string[] = [];
const meteredConfirmations: ConfirmSpendCommandData[] = [];
const meteredSpans: Record<string, any>[] = [];

class SilentCrossings implements Pick<GatewayBudgetCrossingService, "detect"> {
  async detect(): Promise<void> {}
}

class DiscardedChanges implements Pick<GatewayChangeEvents, "append"> {
  async append(): Promise<{ revision: bigint }> {
    return { revision: 0n };
  }
}

class OpenDedupeWindow extends GatewayBudgetChangeDedupeRepository {
  async claimWindow(): Promise<boolean> {
    return true;
  }
}

/**
 * Confirms as the spend pipeline's debit process does: an outcome that moved nothing writes
 * no debit, any other goes to the one debit writer against the real ledger.
 */
class DebitingSpendConfirmation implements GatewaySpendConfirmation {
  async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    meteredConfirmations.push(data);
    const movedNothing =
      data.cost_nano_usd === 0 && Object.values(data.usage).every((quantity) => quantity === 0);
    if (movedNothing) return;

    await GatewaySpendDebitService.create({
      budgets: budgetService,
      spend: chRepo,
      dedupe: GatewayBudgetChangeDedupeService.create(new OpenDedupeWindow()),
      changes: new DiscardedChanges(),
      crossings: new SilentCrossings(),
    }).write(
      writeGatewayDebitsSchema.parse({
        gateway_request_id: data.gateway_request_id,
        project_id: data.tenantId,
        organization_id: data.organization_id,
        team_id: data.team_id,
        virtual_key_id: data.virtual_key_id,
        principal_user_id: data.principal_user_id,
        end_user_id: data.end_user_id,
        model: data.model,
        model_provider_id: data.model_provider_id,
        usage: data.usage,
        cost_nano_usd: data.cost_nano_usd,
        rate_version: data.rate_version,
        status: "confirmed",
        duration_ms: data.duration_ms,
        occurred_at: data.occurred_at,
      }),
    );
  }
}

class MeteredSpanIngestion implements GatewaySpanIngestion {
  async ingestNormalizedSpan(input: any): Promise<void> {
    meteredSpans.push(input);
  }
}

const meteredCollaborators: GatewayRealtimeSessionCollaborators = {
  sessions: PrismaGatewayRealtimeSessionRepository.create({
    get database() {
      return prisma;
    },
  }),
  spendRating: rating,
  spendConfirmation: new DebitingSpendConfirmation(),
  spanIngestion: new MeteredSpanIngestion(),
  attribution: {
    findSessionAttribution: async ({ virtualKeyId, projectId }) => {
      const [key, project] = await Promise.all([
        prisma.virtualKey.findUnique({ where: { id: virtualKeyId } }),
        prisma.project.findUnique({ where: { id: projectId } }),
      ]);
      return { principalUserId: key?.principalUserId ?? null, teamId: project?.teamId ?? null };
    },
  },
  budgets: {
    checkBudget: (input) => budgetService.checkBudget(input),
  },
};

/** A project, a key on it, a 5 USD blocking budget on the key and a 50 USD one on the project. */
async function budgetedChain() {
  const tag = nanoid(6);
  const projectId = `project-rtm-${tag}`;
  const virtualKeyId = `vk-rtm-${tag}`;
  const keyBudgetId = `bdg-key-${tag}`;
  const projectBudgetId = `bdg-proj-${tag}`;
  await prisma.project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      teamId: METERED_TEAM_ID,
      language: "en",
      framework: "openai",
      apiKey: `key-${projectId}`,
    },
  });
  meteredProjectIds.push(projectId);
  await prisma.virtualKey.create({
    data: {
      id: virtualKeyId,
      organizationId: METERED_ORG_ID,
      name: virtualKeyId,
      hashedSecret: `hash-${virtualKeyId}`,
      displayPrefix: "vk-lw-xxxxxxx",
      createdById: METERED_USER_ID,
      traceProjectId: projectId,
      scopes: { create: [{ scopeType: "PROJECT", scopeId: projectId }] },
    },
  });
  const resetsAt = toDate(nowInstant().add({ hours: 24 * 40 }));
  await prisma.gatewayBudget.createMany({
    data: [
      {
        id: keyBudgetId,
        name: keyBudgetId,
        organizationId: METERED_ORG_ID,
        scopeType: "VIRTUAL_KEY",
        scopeId: virtualKeyId,
        window: "MONTH",
        limitUsd: "5",
        onBreach: "BLOCK",
        createdById: METERED_USER_ID,
        resetsAt,
      },
      {
        id: projectBudgetId,
        name: projectBudgetId,
        organizationId: METERED_ORG_ID,
        scopeType: "PROJECT",
        scopeId: projectId,
        window: "MONTH",
        limitUsd: "50",
        onBreach: "BLOCK",
        createdById: METERED_USER_ID,
        resetsAt,
      },
    ],
  });

  const sessionId = `sess-rtm-${tag}`;
  const traceId = `trace-rtm-${tag}`;
  await realtimeSessions.reserveRealtimeSession({
    sessionId,
    projectId,
    organizationId: METERED_ORG_ID,
    virtualKeyId,
    modelProviderId: PROVIDER_ID,
    vendor: "openai",
    model: REALTIME_MODEL,
    traceId,
    kind: "realtime",
    metering: "client",
    collaborators: meteredCollaborators,
  });

  const report = (input: { usage?: Partial<SpendUsage>; reportKey?: string; final?: boolean }) =>
    metering.reportRealtimeSessionUsage({
      sessionId,
      projectId,
      virtualKeyId,
      ...input,
      collaborators: meteredCollaborators,
    });
  /** What the ledger holds for a budget, and how many debits make it up. */
  const ledger = async (budgetId: string) => {
    const debits = await chRepo.recentEventsForBudget([projectId], budgetId, 50);
    const spentNanoUsd = debits.reduce(
      (total, debit) => total + Math.round(Number(debit.amountUsd) * USD),
      0,
    );
    return { debits: debits.map((debit) => debit.id).toSorted(), spentNanoUsd };
  };
  const nextRequest = () =>
    budgetService.checkBudget({
      organizationId: METERED_ORG_ID,
      teamId: METERED_TEAM_ID,
      projectId,
      virtualKeyId,
      principalUserId: null,
      projectedCostUsd: "0",
    });
  const session = () =>
    prisma.gatewayRealtimeSession.findUniqueOrThrow({ where: { id: sessionId } });
  const ageSessionPastTheWindow = () =>
    prisma.gatewayRealtimeSession.update({
      where: { id: sessionId },
      data: {
        mintedAt: toDate(
          nowInstant().subtract({ milliseconds: REALTIME_OPEN_SESSION_WINDOW_MS + 60_000 }),
        ),
      },
    });
  const confirmations = () =>
    meteredConfirmations.filter((sent) => sent.gateway_request_id.startsWith(sessionId));

  return {
    projectId,
    virtualKeyId,
    keyBudgetId,
    projectBudgetId,
    sessionId,
    traceId,
    report,
    ledger,
    nextRequest,
    session,
    ageSessionPastTheWindow,
    confirmations,
  };
}

function reconciler() {
  return GatewayRealtimeSessionReconciliationService.create({
    repository: GatewayRealtimeSessionSweepService.create(meteredCollaborators),
    credentials: GatewayElevenLabsCredentialService.create({
      modelProviders: createApiFixture<ModelProviderApi>({}),
    }),
    conversations: MemoryElevenLabsConversationChannel.create(),
    logger: { warn: () => void 0, info: () => void 0, error: () => void 0 },
    config: realtimeSessionReconciliationConfig,
    clock: { now: () => nowInstant() },
  });
}

describe.skipIf(!databaseUrl || !chUrl)(
  "given a key with a 5 USD blocking budget on a project with a 50 USD one",
  () => {
    beforeAll(async () => {
      chRepo = new GatewayBudgetClickHouseRepository(async () =>
        createTestClickHouseClient(chUrl!),
      );
      await prisma.organization.create({
        data: { id: METERED_ORG_ID, name: `Org ${suffix}`, slug: METERED_ORG_ID },
      });
      await prisma.team.create({
        data: {
          id: METERED_TEAM_ID,
          name: `Team ${suffix}`,
          slug: METERED_TEAM_ID,
          organizationId: METERED_ORG_ID,
        },
      });
      await prisma.user.create({
        data: { id: METERED_USER_ID, email: `${METERED_USER_ID}@acme.test`, name: "ACME Admin" },
      });
      budgetService = PrismaGatewayAdapter.create({
        database: prisma,
        organizations: organizationApiOver(prisma),
        projects: createApiFixture<ProjectApi>(
          { listIdsByOrganization: async () => [...meteredProjectIds] },
          "MeteredSuiteProjects",
        ),
        evaluators: {} as never,
        monitors: {} as never,
        changes: {} as never,
        audit: {} as never,
        budgetSpend: chRepo,
      }).build();
    }, 120_000);

    afterAll(async () => {
      const client = createTestClickHouseClient(chUrl!);
      for (const tenantId of meteredProjectIds) {
        for (const table of ["gateway_budget_ledger_events", "gateway_budget_scope_totals"]) {
          await client.command({
            query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String}`,
            query_params: { tenantId },
          });
        }
      }
      const connectionForCleanup = createGatewayTestPrismaConnection(databaseUrl!);
      const cleanup = connectionForCleanup.client as PrismaClient;
      await cleanup.gatewayRealtimeSessionReport.deleteMany({
        where: { projectId: { in: meteredProjectIds } },
      });
      await cleanup.gatewayRealtimeSession.deleteMany({
        where: { organizationId: METERED_ORG_ID },
      });
      await cleanup.gatewayBudget.deleteMany({ where: { organizationId: METERED_ORG_ID } });
      await cleanup.virtualKey.deleteMany({ where: { organizationId: METERED_ORG_ID } });
      await cleanup.project.deleteMany({ where: { teamId: METERED_TEAM_ID } });
      await cleanup.team.deleteMany({ where: { id: METERED_TEAM_ID } });
      await cleanup.organization.deleteMany({ where: { id: METERED_ORG_ID } });
      await cleanup.user.deleteMany({ where: { id: METERED_USER_ID } });
      await cleanup.$disconnect();
    }, 120_000);

    describe("when two usage reports arrive, each for its own response", () => {
      /** @scenario "Each report debits every budget on the key's chain once" */
      it("grows the recorded cost and debits both budgets once per report", async () => {
        const chain = await budgetedChain();

        const first = await chain.report({ reportKey: "resp_1", usage: usd(1) });
        const second = await chain.report({ reportKey: "resp_2", usage: usd(1) });

        expect(first).toMatchObject({
          status: "recorded",
          costNanoUsd: USD,
          sessionCostNanoUsd: USD,
        });
        expect(second).toMatchObject({
          status: "recorded",
          costNanoUsd: USD,
          sessionCostNanoUsd: 2 * USD,
        });
        const expectedDebits = [`${chain.sessionId}.resp_1`, `${chain.sessionId}.resp_2`];
        expect(await chain.ledger(chain.keyBudgetId)).toEqual({
          debits: expectedDebits,
          spentNanoUsd: 2 * USD,
        });
        expect(await chain.ledger(chain.projectBudgetId)).toEqual({
          debits: expectedDebits,
          spentNanoUsd: 2 * USD,
        });
        const stored = await chain.session();
        expect(stored.status).toBe("OPEN");
        expect(stored.reportCount).toBe(2);
        expect(Number(stored.reportedCostNanoUsd)).toBe(2 * USD);
      });
    });

    describe("when the same report is delivered again", () => {
      /** @scenario "A report delivered twice debits its budgets once" */
      it("moves neither budget", async () => {
        const chain = await budgetedChain();
        await chain.report({ reportKey: "resp_1", usage: usd(1) });

        const again = await chain.report({ reportKey: "resp_1", usage: usd(1) });

        expect(again).toMatchObject({
          status: "duplicate",
          costNanoUsd: 0,
          sessionCostNanoUsd: USD,
        });
        expect((await chain.ledger(chain.keyBudgetId)).spentNanoUsd).toBe(USD);
        expect((await chain.ledger(chain.projectBudgetId)).spentNanoUsd).toBe(USD);
        expect((await chain.session()).reportCount).toBe(1);
      });
    });

    describe("when a report takes the key's budget to its limit", () => {
      /** @scenario "A breach of the key's budget is flagged in the usage response" */
      it("flags the key's budget and blocks the key's next request", async () => {
        const chain = await budgetedChain();
        const under = await chain.report({ reportKey: "resp_1", usage: usd(2) });

        const breaching = await chain.report({ reportKey: "resp_2", usage: usd(3) });

        expect(under).toMatchObject({ budget: { exceeded: false } });
        expect(breaching).toMatchObject({
          budget: { exceeded: true, scope: "virtual_key", budgetId: chain.keyBudgetId },
        });
        expect(breaching).not.toHaveProperty("budget.unknown");
        const next = await chain.nextRequest();
        expect(next.decision).toBe("hard_block");
        expect(next.blockedBy.map((blocked) => blocked.budgetId)).toEqual([chain.keyBudgetId]);
      });
    });

    describe("when a report takes the project's budget to its limit", () => {
      /** @scenario "A breach of the project's budget is flagged in the usage response" */
      it("flags the project's budget and blocks the key's next request", async () => {
        const chain = await budgetedChain();
        // Another key on the project spent 48 USD of the project's 50.
        await chRepo.insertDebitsForBudgets([
          {
            tenantId: chain.projectId,
            budgetId: chain.projectBudgetId,
            scope: "PROJECT",
            scopeId: chain.projectId,
            window: "MONTH",
            virtualKeyId: "vk-sibling",
            gatewayRequestId: `grq_${nanoid()}`,
            amountNanoUsd: 48 * USD,
            tokensInput: 0,
            tokensOutput: 0,
            tokensCacheRead: 0,
            tokensCacheWrite: 0,
            model: REALTIME_MODEL,
            durationMs: 0,
            status: "SUCCESS",
            occurredAt: nowInstant(),
          },
        ]);

        const breaching = await chain.report({ reportKey: "resp_1", usage: usd(2) });

        expect(breaching).toMatchObject({
          budget: { exceeded: true, scope: "project", budgetId: chain.projectBudgetId },
        });
        const next = await chain.nextRequest();
        expect(next.decision).toBe("hard_block");
        expect(next.blockedBy.map((blocked) => blocked.budgetId)).toEqual([chain.projectBudgetId]);
      });
    });

    describe("when a session's reports stopped and it outlived the open window", () => {
      /** @scenario "A session whose reports stopped is closed at what was recorded" */
      it("closes it with its recorded cost and confirms its own record", async () => {
        const chain = await budgetedChain();
        await chain.report({ reportKey: "resp_1", usage: usd(1) });
        await chain.ageSessionPastTheWindow();

        const tick = await reconciler().poll();

        expect(tick.settled).toBeGreaterThanOrEqual(1);
        const stored = await chain.session();
        expect(stored.status).toBe("CLOSED");
        expect(stored.closeReason).toBe("closed by window; reported usage stands");
        expect(Number(stored.reportedCostNanoUsd)).toBe(USD);
        expect(await chain.ledger(chain.keyBudgetId)).toEqual({
          debits: [`${chain.sessionId}.resp_1`],
          spentNanoUsd: USD,
        });
        // The admitted record is confirmed at no quantities rather than left for the
        // settlement sweeper to mark cost unknown.
        expect(chain.confirmations().at(-1)).toMatchObject({
          gateway_request_id: chain.sessionId,
          request_type: "realtime_session",
          cost_nano_usd: 0,
          usage: EMPTY_SPEND_USAGE,
        });
      });
    });

    describe("when a realtime session never reported and outlived the open window", () => {
      /** @scenario "An unreported realtime session settles at the estimate" */
      it("confirms the estimate as its one report, debits it and closes", async () => {
        const chain = await budgetedChain();
        await chain.ageSessionPastTheWindow();

        const tick = await reconciler().poll();

        // Ten minutes assumed: 6000 input audio tokens and 6000 output audio tokens.
        const estimate = rating.rate({
          model: REALTIME_MODEL,
          usage: { ...EMPTY_SPEND_USAGE, input_audio_tokens: 6000, output_audio_tokens: 6000 },
        }).costNanoUsd;
        expect(estimate).toBeGreaterThan(0);
        expect(tick.estimated).toBeGreaterThanOrEqual(1);
        const stored = await chain.session();
        expect(stored.status).toBe("CLOSED");
        expect(stored.closeReason).toBe("estimated: no usage report arrived");
        expect(stored.reportCount).toBe(1);
        expect(Number(stored.reportedCostNanoUsd)).toBe(estimate);
        expect(await chain.ledger(chain.keyBudgetId)).toEqual({
          debits: [`${chain.sessionId}.estimate`],
          spentNanoUsd: estimate,
        });
        expect(await chain.ledger(chain.projectBudgetId)).toEqual({
          debits: [`${chain.sessionId}.estimate`],
          spentNanoUsd: estimate,
        });
      });
    });

    describe("when the client posts one usage report with no report key", () => {
      /** @scenario "A single report with no report key closes the session as it always did" */
      it("confirms the whole usage on the session's own record and closes", async () => {
        const chain = await budgetedChain();

        const receipt = await chain.report({ usage: usd(1) });

        expect(receipt).toMatchObject({
          status: "closed",
          costNanoUsd: USD,
          sessionCostNanoUsd: USD,
        });
        expect(chain.confirmations()).toHaveLength(1);
        expect(chain.confirmations()[0]).toMatchObject({
          gateway_request_id: chain.sessionId,
          request_type: "realtime_session",
          cost_nano_usd: USD,
        });
        const stored = await chain.session();
        expect(stored.status).toBe("CLOSED");
        expect(stored.closeReason).toBe("usage reported by the client");
        expect(stored.reportCount).toBe(0);
        expect(await chain.ledger(chain.keyBudgetId)).toEqual({
          debits: [chain.sessionId],
          spentNanoUsd: USD,
        });
      });
    });

    describe("when the client posts the session total after keyed reports", () => {
      /** @scenario "A session total after keyed reports confirms only the remainder" */
      it("confirms what the reports left out and states the whole total on the span once", async () => {
        const chain = await budgetedChain();
        await chain.report({ reportKey: "resp_1", usage: usd(1) });
        await chain.report({ reportKey: "resp_2", usage: usd(1) });

        const receipt = await chain.report({ usage: usd(3) });

        expect(receipt).toMatchObject({
          status: "closed",
          costNanoUsd: USD,
          sessionCostNanoUsd: 3 * USD,
        });
        expect(chain.confirmations().at(-1)).toMatchObject({
          gateway_request_id: chain.sessionId,
          cost_nano_usd: USD,
          usage: { ...EMPTY_SPEND_USAGE, ...usd(1) },
        });
        expect((await chain.ledger(chain.keyBudgetId)).spentNanoUsd).toBe(3 * USD);
        expect(Number((await chain.session()).reportedCostNanoUsd)).toBe(3 * USD);

        const spans = meteredSpans.filter((span) => span.span.traceId === chain.traceId);
        expect(spans).toHaveLength(1);
        expect(spanAttr(spans[0]!, "langwatch.span.cost")).toBeCloseTo(3, 9);
        expect(spanAttr(spans[0]!, "gen_ai.usage.output_audio_tokens")).toBe(3 * TOKENS_PER_USD);
      });
    });
  },
);
