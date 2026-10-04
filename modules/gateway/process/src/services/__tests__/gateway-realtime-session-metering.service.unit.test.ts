/**
 * @vitest-environment node
 * @see modules/gateway/specs/gateway-realtime-session-metering.feature
 * Usage reports and the settlement sweep over the memory session repository.
 */
import type {
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
  SpendUsage,
} from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GatewaySpanIngestion, GatewaySpendConfirmation } from "../../app/gateway.members.ts";
import { MemoryElevenLabsConversationChannel } from "../../channels/memory/memory.elevenlabs-conversation.channel.ts";
import type { ConfirmSpendCommandData } from "../../eventing/gateway-spend-commands.process.ts";
import { MemoryGatewayRealtimeSessionRepository } from "../../repositories/memory/memory.gateway-realtime-session.repository.ts";
import { EMPTY_SPEND_USAGE } from "../../rules/gateway-spend-projection.rules.ts";
import { GatewayElevenLabsCredentialService } from "../gateway-elevenlabs-credential.service.ts";
import { GatewayRealtimeSessionMeteringService } from "../gateway-realtime-session-metering.service.ts";
import {
  GatewayRealtimeSessionReconciliationService,
  realtimeSessionReconciliationConfig,
} from "../gateway-realtime-session-reconciliation.service.ts";
import { GatewayRealtimeSessionSweepService } from "../gateway-realtime-session-sweep.service.ts";
import {
  GatewayRealtimeSessionService,
  REALTIME_OPEN_SESSION_WINDOW_MS,
  type GatewayRealtimeSessionCollaborators,
  type ReserveInput,
} from "../gateway-realtime-session.service.ts";
import { ModelCatalogGatewaySpendRatingService } from "../model-catalog-gateway-spend-rating.service.ts";

const PROJECT_ID = "project-1";
const ORG_ID = "organization-1";
const KEY_ID = "key-1";
const SESSION_ID = "session-1";
const MODEL = "openai/gpt-realtime-1.5";
const TRANSCRIPTION_MODEL = "elevenlabs/scribe_v1";

const rating = ModelCatalogGatewaySpendRatingService.create();
const operations = GatewayRealtimeSessionService.create();
const metering = GatewayRealtimeSessionMeteringService.create();

function costOf(usage: Partial<SpendUsage>, model = MODEL): number {
  return rating.rate({ model, usage: { ...EMPTY_SPEND_USAGE, ...usage } }).costNanoUsd;
}

class RecordingSpendConfirmation implements GatewaySpendConfirmation {
  readonly sent: ConfirmSpendCommandData[] = [];

  async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    this.sent.push(data);
  }
}

class RecordingSpanIngestion implements GatewaySpanIngestion {
  readonly spans: Parameters<GatewaySpanIngestion["ingestNormalizedSpan"]>[0][] = [];

  async ingestNormalizedSpan(
    input: Parameters<GatewaySpanIngestion["ingestNormalizedSpan"]>[0],
  ): Promise<void> {
    this.spans.push(input);
  }
}

/** One blocking key budget whose ledger holds `ledgerNanoUsd`; blocks at the limit. */
class LedgerBudgetCheck {
  readonly asked: GatewayBudgetCheckInput[] = [];

  constructor(private readonly budget: { limitNanoUsd: number; ledgerNanoUsd: number }) {}

  async checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult> {
    this.asked.push(input);
    const projectedNanoUsd = Math.round(Number(input.projectedCostUsd) * 1_000_000_000);
    const blocked = this.budget.ledgerNanoUsd + projectedNanoUsd >= this.budget.limitNanoUsd;
    const line = {
      budgetId: "budget-key",
      scope: "virtual_key",
      scopeId: KEY_ID,
      window: "month",
      limitUsd: "5",
      spentUsd: "0",
    };

    return {
      decision: blocked ? "hard_block" : "allow",
      warnings: [],
      blockReason: blocked ? "Budget exceeded" : null,
      blockedBy: blocked ? [line] : [],
      scopes: [],
    };
  }
}

class FailingBudgetCheck {
  async checkBudget(): Promise<GatewayBudgetCheckResult> {
    throw new Error("the budget store is unreachable");
  }
}

function attr(span: RecordingSpanIngestion["spans"][number], key: string): unknown {
  const attributes = span.span.attributes as {
    key: string;
    value: { doubleValue?: number; stringValue?: string };
  }[];
  const found = attributes.find((attribute) => attribute.key === key);

  return found?.value.doubleValue ?? found?.value.stringValue;
}

async function openSession(options?: {
  session?: Partial<ReserveInput>;
  budgets?: GatewayRealtimeSessionCollaborators["budgets"];
  maxOpenSessions?: Record<string, number>;
}) {
  const sessions = MemoryGatewayRealtimeSessionRepository.create({
    maxOpenSessions: options?.maxOpenSessions ?? {},
  });
  const spend = new RecordingSpendConfirmation();
  const spans = new RecordingSpanIngestion();
  const collaborators: GatewayRealtimeSessionCollaborators = {
    sessions,
    spendRating: rating,
    spendConfirmation: spend,
    spanIngestion: spans,
    attribution: {
      findSessionAttribution: async () => ({ principalUserId: "user-1", teamId: "team-1" }),
    },
    budgets: options?.budgets,
  };
  const reserve = (sessionId: string, session?: Partial<ReserveInput>) =>
    operations.reserveRealtimeSession({
      sessionId,
      projectId: PROJECT_ID,
      organizationId: ORG_ID,
      virtualKeyId: KEY_ID,
      modelProviderId: "provider-1",
      vendor: "openai",
      model: MODEL,
      traceId: "trace-1",
      kind: "realtime",
      metering: "client",
      ...options?.session,
      ...session,
      collaborators,
    });
  await reserve(SESSION_ID);
  const report = (input: {
    usage?: Partial<SpendUsage>;
    reportKey?: string;
    model?: string;
    pricedAs?: "transcription";
    final?: boolean;
    now?: Instant;
  }) =>
    metering.reportRealtimeSessionUsage({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      virtualKeyId: KEY_ID,
      ...input,
      collaborators,
    });
  const reconciler = GatewayRealtimeSessionReconciliationService.create({
    repository: GatewayRealtimeSessionSweepService.create(collaborators),
    credentials: GatewayElevenLabsCredentialService.create({
      modelProviders: createApiFixture<ModelProviderApi>({}),
    }),
    conversations: MemoryElevenLabsConversationChannel.create(),
    logger: { warn: () => void 0, info: () => void 0, error: () => void 0 },
    config: realtimeSessionReconciliationConfig,
    clock: { now: () => nowInstant() },
  });
  const row = (sessionId = SESSION_ID) => {
    const found = sessions.rows.get(sessionId);
    if (!found) throw new Error(`no session ${sessionId}`);
    return found;
  };
  /** Moves a session's mint into the past, as a row that has been open that long. */
  const age = (milliseconds: number, sessionId = SESSION_ID) => {
    const current = row(sessionId);
    sessions.rows.set(sessionId, {
      ...current,
      mintedAt: current.mintedAt.subtract({ milliseconds }),
    });
  };

  return { sessions, spend, spans, collaborators, reserve, report, reconciler, row, age };
}

const PAST_WINDOW_MS = REALTIME_OPEN_SESSION_WINDOW_MS + 60_000;

describe("a usage report of a realtime session", () => {
  describe("when it names the response it belongs to", () => {
    /** @scenario "A keyed report is confirmed as its own spend record and leaves the session open" */
    it("confirms one spend record with the session's attribution and stays open", async () => {
      const { spend, report, row } = await openSession();
      const usage = { input_audio_tokens: 100, output_audio_tokens: 50 };

      const receipt = await report({ reportKey: "resp_1", usage });

      expect(receipt).toMatchObject({
        status: "recorded",
        costNanoUsd: costOf(usage),
        sessionCostNanoUsd: costOf(usage),
      });
      expect(spend.sent).toHaveLength(1);
      expect(spend.sent[0]).toMatchObject({
        gateway_request_id: `${SESSION_ID}.resp_1`,
        request_type: "realtime_response",
        tenantId: PROJECT_ID,
        organization_id: ORG_ID,
        virtual_key_id: KEY_ID,
        principal_user_id: "user-1",
        team_id: "team-1",
        trace_id: "trace-1",
        model: MODEL,
        cost_nano_usd: costOf(usage),
      });
      expect(row().status).toBe("OPEN");
      expect(row().reportCount).toBe(1);
      expect(row().reportedCostNanoUsd).toBe(costOf(usage));
    });
  });

  describe("when the same report is delivered again", () => {
    /** @scenario "Two reports with the same response id count once" */
    it("confirms nothing more and answers duplicate", async () => {
      const { spend, report, row } = await openSession();
      const usage = { input_audio_tokens: 100 };
      await report({ reportKey: "resp_1", usage });

      const again = await report({ reportKey: "resp_1", usage: { input_audio_tokens: 999 } });

      expect(again).toMatchObject({
        status: "duplicate",
        costNanoUsd: 0,
        sessionCostNanoUsd: costOf(usage),
      });
      expect(spend.sent).toHaveLength(1);
      expect(row().reportCount).toBe(1);
      expect(row().reportedCostNanoUsd).toBe(costOf(usage));
    });
  });

  describe("when the session has already closed", () => {
    /** @scenario "A report after the session closed records nothing" */
    it("confirms nothing and answers already closed", async () => {
      const { spend, report, sessions } = await openSession();
      await report({ final: true });
      const confirmedAtClose = spend.sent.length;

      const late = await report({ reportKey: "resp_late", usage: { input_audio_tokens: 500 } });

      expect(late).toMatchObject({ status: "already_closed", costNanoUsd: 0 });
      expect(spend.sent).toHaveLength(confirmedAtClose);
      expect(sessions.reports).toHaveLength(0);
    });
  });

  describe("when it is priced as transcription", () => {
    /** @scenario "A transcription report is priced under the session's transcription model" */
    it("rates under the transcription model, and under a model the report names itself", async () => {
      const { spend, report } = await openSession({
        session: { transcriptionModel: TRANSCRIPTION_MODEL },
      });

      const transcribed = await report({
        reportKey: "item_1",
        pricedAs: "transcription",
        usage: { audio_ms: 60_000 },
      });
      await report({
        reportKey: "resp_2",
        model: "openai/gpt-realtime-2.1",
        usage: { output_tokens: 5 },
      });

      expect(transcribed).toMatchObject({
        costNanoUsd: costOf({ audio_ms: 60_000 }, TRANSCRIPTION_MODEL),
      });
      expect(spend.sent.map((sent) => sent.model)).toEqual([
        TRANSCRIPTION_MODEL,
        "openai/gpt-realtime-2.1",
      ]);
    });

    it("falls back to the session's model when it declared no transcription model", async () => {
      const { spend, report } = await openSession();

      await report({ reportKey: "item_1", pricedAs: "transcription", usage: { audio_ms: 1000 } });

      expect(spend.sent[0]?.model).toBe(MODEL);
    });
  });

  describe("when it is marked final", () => {
    /** @scenario "A final report records its usage and closes the session" */
    it("records the usage as a report and closes on a record with no quantities", async () => {
      const { spend, report, row, sessions } = await openSession();
      const usage = { output_audio_tokens: 80 };

      const receipt = await report({ final: true, usage });

      expect(receipt).toMatchObject({ status: "closed", costNanoUsd: costOf(usage) });
      expect(sessions.reports.map((stored) => stored.reportKey)).toEqual(["final"]);
      expect(spend.sent.map((sent) => sent.gateway_request_id)).toEqual([
        `${SESSION_ID}.final`,
        SESSION_ID,
      ]);
      expect(spend.sent[1]).toMatchObject({ cost_nano_usd: 0, usage: EMPTY_SPEND_USAGE });
      expect(row().status).toBe("CLOSED");
    });

    /** @scenario "A bare close records no usage" */
    it("closes with no report when it carries no usage", async () => {
      const { spend, report, row, sessions } = await openSession();

      const receipt = await report({ final: true });

      expect(receipt).toMatchObject({ status: "closed", costNanoUsd: 0 });
      expect(sessions.reports).toHaveLength(0);
      expect(spend.sent.map((sent) => sent.gateway_request_id)).toEqual([SESSION_ID]);
      expect(row().status).toBe("CLOSED");
    });
  });

  describe("when the report key has no character a record id may carry", () => {
    it("still records it under a key of its own", async () => {
      const { sessions, report } = await openSession();

      await report({ reportKey: "...", usage: { input_tokens: 1 } });
      await report({ reportKey: "///", usage: { input_tokens: 1 } });

      expect(new Set(sessions.reports.map((stored) => stored.reportKey)).size).toBe(2);
    });
  });
});

describe("a session total, reported with no report key", () => {
  /** @scenario "A session total with no earlier reports confirms the whole total" */
  it("confirms the whole usage on the session's own record and closes", async () => {
    const { spend, report, row } = await openSession();
    const usage = { input_tokens: 10, output_tokens: 5 };

    const receipt = await report({ usage });

    expect(receipt).toMatchObject({
      status: "closed",
      costNanoUsd: costOf(usage),
      sessionCostNanoUsd: costOf(usage),
    });
    expect(spend.sent).toHaveLength(1);
    expect(spend.sent[0]).toMatchObject({
      gateway_request_id: SESSION_ID,
      request_type: "realtime_session",
      usage: { ...EMPTY_SPEND_USAGE, ...usage },
    });
    expect(row().status).toBe("CLOSED");
    expect(row().closeReason).toBe("usage reported by the client");
  });

  /** @scenario "A session total after keyed reports confirms only what they left out" */
  it("confirms only the quantities the reports did not record", async () => {
    const { spend, report } = await openSession();
    await report({ reportKey: "resp_1", usage: { input_audio_tokens: 100, output_tokens: 30 } });
    await report({ reportKey: "resp_2", usage: { input_audio_tokens: 50 } });

    const receipt = await report({
      usage: { input_audio_tokens: 400, output_audio_tokens: 70, output_tokens: 10 },
    });

    const remainder = { input_audio_tokens: 250, output_audio_tokens: 70, output_tokens: 0 };
    expect(receipt).toMatchObject({ status: "closed", costNanoUsd: costOf(remainder) });
    expect(spend.sent.at(-1)).toMatchObject({
      gateway_request_id: SESSION_ID,
      usage: { ...EMPTY_SPEND_USAGE, ...remainder },
      cost_nano_usd: costOf(remainder),
    });
  });

  /** @scenario "The settlement span states the whole call" */
  it("writes one span carrying the reports' sum plus what its own record confirmed", async () => {
    const { spans, report } = await openSession();
    const first = { input_audio_tokens: 100 };
    const second = { output_audio_tokens: 50 };
    await report({ reportKey: "resp_1", usage: first });
    await report({ reportKey: "resp_2", usage: second });
    expect(spans.spans).toHaveLength(0);

    await report({ usage: { input_audio_tokens: 160, output_audio_tokens: 50 } });

    expect(spans.spans).toHaveLength(1);
    const span = spans.spans[0]!;
    const whole = costOf(first) + costOf(second) + costOf({ input_audio_tokens: 60 });
    expect(attr(span, "langwatch.span.cost")).toBeCloseTo(whole / 1_000_000_000, 12);
    expect(attr(span, "gen_ai.usage.input_audio_tokens")).toBe(160);
    expect(attr(span, "gen_ai.usage.output_audio_tokens")).toBe(50);
  });
});

describe("the budget verdict a usage report answers with", () => {
  const usage = { output_audio_tokens: 1000 };

  /** @scenario "A report that takes a blocking budget to its limit says so" */
  it("flags the budget and names its scope and id", async () => {
    const budgets = new LedgerBudgetCheck({ limitNanoUsd: costOf(usage), ledgerNanoUsd: 0 });
    const { report } = await openSession({ budgets });

    const receipt = await report({ reportKey: "resp_1", usage });

    expect(receipt).toMatchObject({
      budget: { exceeded: true, scope: "virtual_key", budgetId: "budget-key" },
    });
    expect(budgets.asked[0]).toMatchObject({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      virtualKeyId: KEY_ID,
      teamId: "team-1",
      principalUserId: "user-1",
      providerKey: "provider-1",
    });
  });

  /** @scenario "The session's recent reports count before the ledger holds them" */
  it("counts the reports of the last minute on top of the ledger's spend", async () => {
    const budgets = new LedgerBudgetCheck({ limitNanoUsd: 3 * costOf(usage), ledgerNanoUsd: 0 });
    const { report } = await openSession({ budgets });
    const now = nowInstant();

    const first = await report({ reportKey: "resp_1", usage, now });
    const second = await report({ reportKey: "resp_2", usage, now: now.add({ seconds: 5 }) });
    const third = await report({ reportKey: "resp_3", usage, now: now.add({ seconds: 10 }) });

    expect(first).toMatchObject({ budget: { exceeded: false } });
    expect(second).toMatchObject({ budget: { exceeded: false } });
    expect(third).toMatchObject({ budget: { exceeded: true } });
    expect(Number(budgets.asked[2]?.projectedCostUsd)).toBeCloseTo(
      (3 * costOf(usage)) / 1_000_000_000,
      9,
    );
  });

  it("stops counting a report once the ledger has had time to hold it", async () => {
    const budgets = new LedgerBudgetCheck({ limitNanoUsd: 2 * costOf(usage), ledgerNanoUsd: 0 });
    const { report } = await openSession({ budgets });
    const now = nowInstant();
    await report({ reportKey: "resp_1", usage, now });

    const later = await report({ reportKey: "resp_2", usage, now: now.add({ minutes: 5 }) });

    expect(later).toMatchObject({ budget: { exceeded: false } });
  });

  /** @scenario "A budget read that fails answers unknown rather than a guess" */
  it("records the report and marks the verdict unknown", async () => {
    const { report, row } = await openSession({ budgets: new FailingBudgetCheck() });

    const receipt = await report({ reportKey: "resp_1", usage });

    expect(receipt).toMatchObject({
      status: "recorded",
      budget: { exceeded: false, unknown: true },
    });
    expect(row().reportCount).toBe(1);
  });

  it("marks the verdict unknown where no budget read is composed", async () => {
    const { report } = await openSession();

    expect(await report({ reportKey: "resp_1", usage })).toMatchObject({
      budget: { exceeded: false, unknown: true },
    });
  });
});

describe("the reconciler, over metered sessions nothing closed", () => {
  describe("when a client-metered session past the window never reported", () => {
    /** @scenario "A client-metered session that never reported settles at an estimate" */
    it("records an estimate as its one report and closes it", async () => {
      const { spend, sessions, reconciler, row, age } = await openSession();
      age(PAST_WINDOW_MS);

      const tick = await reconciler.poll();

      const estimated = { input_audio_tokens: 6000, output_audio_tokens: 6000 };
      expect(tick).toMatchObject({ settled: 1, estimated: 1 });
      expect(sessions.reports.map((stored) => stored.reportKey)).toEqual(["estimate"]);
      expect(spend.sent.map((sent) => sent.gateway_request_id)).toEqual([
        `${SESSION_ID}.estimate`,
        SESSION_ID,
      ]);
      expect(spend.sent[0]).toMatchObject({
        usage: { ...EMPTY_SPEND_USAGE, ...estimated },
        cost_nano_usd: costOf(estimated),
      });
      expect(row().status).toBe("CLOSED");
      expect(row().closeReason).toBe("estimated: no usage report arrived");
      expect(row().reportedCostNanoUsd).toBe(costOf(estimated));
    });

    it("settles nothing more on the next tick", async () => {
      const { spend, reconciler, age } = await openSession();
      age(PAST_WINDOW_MS);
      await reconciler.poll();
      const confirmed = spend.sent.length;

      expect(await reconciler.poll()).toMatchObject({ settled: 0, estimated: 0 });
      expect(spend.sent).toHaveLength(confirmed);
    });
  });

  describe("when a client-metered session recorded reports and then went quiet", () => {
    /** @scenario "A session whose reports stopped closes at what was recorded" */
    it("closes on a record with no quantities and estimates nothing", async () => {
      const { spend, sessions, report, reconciler, row, age } = await openSession();
      const usage = { input_audio_tokens: 100 };
      await report({ reportKey: "resp_1", usage });
      age(PAST_WINDOW_MS);

      const tick = await reconciler.poll();

      expect(tick).toMatchObject({ settled: 1, estimated: 0 });
      expect(sessions.reports.map((stored) => stored.reportKey)).toEqual(["resp_1"]);
      expect(spend.sent.at(-1)).toMatchObject({
        gateway_request_id: SESSION_ID,
        cost_nano_usd: 0,
        usage: EMPTY_SPEND_USAGE,
      });
      expect(row().status).toBe("CLOSED");
      expect(row().closeReason).toBe("closed by window; reported usage stands");
      expect(row().reportedCostNanoUsd).toBe(costOf(usage));
    });
  });

  describe("when the session is metered by the gateway", () => {
    /** @scenario "A gateway-metered session is never estimated" */
    it("closes at what was recorded", async () => {
      const { sessions, reconciler, row, age } = await openSession({
        session: { metering: "gateway" },
      });
      age(PAST_WINDOW_MS);

      const tick = await reconciler.poll();

      expect(tick).toMatchObject({ settled: 1, estimated: 0 });
      expect(sessions.reports).toHaveLength(0);
      expect(row().status).toBe("CLOSED");
      expect(row().reportedCostNanoUsd).toBe(0);
    });
  });

  describe("when the key's next mint expired the session under the cap lock", () => {
    /** @scenario "A session expired under the cap lock is still settled" */
    it("settles the expired session and closes it", async () => {
      const { reserve, reconciler, row, age } = await openSession({
        maxOpenSessions: { [KEY_ID]: 1 },
      });
      age(PAST_WINDOW_MS);
      await reserve("session-2");
      expect(row().status).toBe("EXPIRED");

      const tick = await reconciler.poll();

      expect(tick).toMatchObject({ settled: 1, estimated: 1 });
      expect(row().status).toBe("CLOSED");
      expect(row("session-2").status).toBe("OPEN");
    });
  });

  describe("when the gateway released the session because its credential was never used", () => {
    /** @scenario "A session released by the gateway is not estimated" */
    it("leaves it released and charges nothing", async () => {
      const { spend, collaborators, reconciler, row, age } = await openSession();
      await operations.releaseRealtimeSession({
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        status: "EXPIRED",
        reason: "the credential expired unused",
        collaborators,
      });
      age(PAST_WINDOW_MS);

      const tick = await reconciler.poll();

      expect(tick).toMatchObject({ settled: 0, estimated: 0 });
      expect(spend.sent).toHaveLength(0);
      expect(row().status).toBe("EXPIRED");
    });
  });

  describe("when the session was booked without a kind", () => {
    /** @scenario "A session booked without a kind is left to the vendor report" */
    it("expires it as before and charges nothing", async () => {
      const { spend, reconciler, row, age } = await openSession({
        session: { kind: undefined, metering: undefined },
      });
      age(PAST_WINDOW_MS);

      const tick = await reconciler.poll();

      expect(tick).toMatchObject({ expired: 1, settled: 0, estimated: 0 });
      expect(spend.sent).toHaveLength(0);
      expect(row().status).toBe("EXPIRED");
    });
  });

  describe("when a live session the gateway holds has gone silent", () => {
    /** @scenario "A gateway-held session that went silent is closed at its recorded usage" */
    it("closes it for the reason that the gateway lost it", async () => {
      // A duration-priced catalog id, so the recorded seconds carry a cost.
      const { spend, sessions, report, reconciler, row } = await openSession({
        session: { kind: "live", metering: "gateway", model: TRANSCRIPTION_MODEL },
      });
      const usage = { audio_ms: 30_000 };
      const reportedAt = nowInstant().subtract({ minutes: 4 });
      await report({ reportKey: "u-30", usage, now: reportedAt });

      const tick = await reconciler.poll();

      expect(tick).toMatchObject({ settled: 1, estimated: 0 });
      expect(sessions.reports.map((stored) => stored.reportKey)).toEqual(["u-30"]);
      expect(spend.sent.at(-1)).toMatchObject({ gateway_request_id: SESSION_ID, cost_nano_usd: 0 });
      expect(row().status).toBe("CLOSED");
      expect(row().closeReason).toBe("gateway lost the session; closed at recorded usage");
      expect(costOf(usage, TRANSCRIPTION_MODEL)).toBeGreaterThan(0);
      expect(row().reportedCostNanoUsd).toBe(costOf(usage, TRANSCRIPTION_MODEL));
    });

    it("leaves one that reported within three minutes open", async () => {
      const { report, reconciler, row } = await openSession({
        session: { kind: "live", metering: "gateway" },
      });
      await report({ reportKey: "u-30", usage: { audio_ms: 30_000 } });

      expect(await reconciler.poll()).toMatchObject({ settled: 0 });
      expect(row().status).toBe("OPEN");
    });

    /** @scenario "A gateway-metered call still reporting past the open window stays open" */
    it("leaves one past the open window open while it keeps reporting", async () => {
      const { report, reconciler, row, age, collaborators } = await openSession({
        session: { kind: "live", metering: "gateway" },
      });
      age(PAST_WINDOW_MS);
      await report({ reportKey: "u-3660", usage: { audio_ms: 10_000 } });
      await operations.expireStaleRealtimeSessions({ collaborators });

      expect(await reconciler.poll()).toMatchObject({ settled: 0 });
      expect(row().status).toBe("OPEN");
    });

    /** @scenario "A report that measured nothing only marks the session as heard from" */
    it("records no spend for a report that measured nothing, and counts it as heard from", async () => {
      const { spend, sessions, report, row } = await openSession({
        session: { kind: "realtime", metering: "gateway" },
      });

      const receipt = await report({ reportKey: "hb-60", usage: {} });

      expect(receipt).toMatchObject({ status: "recorded", costNanoUsd: 0 });
      expect(spend.sent).toHaveLength(0);
      expect(sessions.reports).toHaveLength(0);
      expect(row().lastReportAt).not.toBeNull();
    });

    it("leaves a silent session the client meters to the open window", async () => {
      const { reconciler, row, age } = await openSession({
        session: { kind: "live", metering: "client" },
      });
      age(4 * 60_000);

      expect(await reconciler.poll()).toMatchObject({ settled: 0 });
      expect(row().status).toBe("OPEN");
    });
  });
});
