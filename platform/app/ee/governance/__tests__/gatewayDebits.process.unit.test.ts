// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import type { GatewayDebitsState } from "../process-manager/gatewayDebits.process";
import {
  gatewayDebitsPM,
  writeGatewayDebitsSchema,
} from "../process-manager/gatewayDebits.process";

const logged = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => logged,
}));

/**
 * Pure harness: replay the applier against a recording builder, then
 * drive the captured event handlers directly. No store, no IO; the
 * intent handler itself is covered by the detector/repository suites.
 */
function capture() {
  const handlers = new Map<
    string,
    (
      state: unknown,
      data: unknown,
      ctx: unknown,
    ) => { state: unknown; intents?: unknown[] }
  >();
  let initial: unknown;
  const builder = {
    state(s: unknown) {
      initial = s;
      return builder;
    },
    intent() {
      return builder;
    },
    on(type: string, fn: never) {
      handlers.set(type, fn);
      return builder;
    },
    toPayload() {
      return builder;
    },
    outbox() {
      return builder;
    },
    transient() {
      return builder;
    },
  };
  gatewayDebitsPM({
    prisma: {} as never,
    budgetCHRepository: {} as never,
  })(builder as never);
  return { handlers, initial: () => initial };
}

const ctx = () => ({
  projectId: "proj_1",
  intents: {
    writeDebits: vi.fn((key: string, payload: unknown) => ({ key, payload })),
  },
});

const usage = (overrides: Record<string, number> = {}) => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_tokens: 0,
  cache_creation_1h_tokens: 0,
  input_audio_tokens: 0,
  output_audio_tokens: 0,
  input_chars: 0,
  audio_ms: 0,
  input_image_tokens: 0,
  output_image_tokens: 0,
  image_count: 0,
  ...overrides,
});

const admission = (overrides: Record<string, unknown> = {}) => ({
  gateway_request_id: "req_1",
  organization_id: "org_1",
  team_id: "team_1",
  virtual_key_id: "vk_1",
  principal_user_id: "usr_1",
  end_user_id: "user_9",
  ...overrides,
});

const outcomeData = (overrides: Record<string, unknown> = {}) => ({
  gateway_request_id: "req_1",
  model: "gpt-x",
  model_provider_id: "mp_1",
  usage: usage({ input_tokens: 10, output_tokens: 5 }),
  cost_nano_usd: 3_500,
  rate_version: "catalog@2026-07-30",
  duration_ms: 120,
  occurred_at: 1_753_800_000_000,
  ...overrides,
});

/** Admit, then hand the outcome to its handler, returning what it committed. */
function admitThen(
  eventType: string,
  data: Record<string, unknown>,
  admitOverrides: Record<string, unknown> = {},
) {
  const { handlers, initial } = capture();
  const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!;
  const outcome = handlers.get(eventType)!;
  const after = admitted(initial(), admission(admitOverrides), ctx());
  const c = ctx();
  const result = outcome(after.state, data, c);
  return { result, writeDebits: c.intents.writeDebits };
}

describe("gateway debits process", () => {
  beforeEach(() => vi.clearAllMocks());

  /** @scenario Attributed debits ride the spend pipeline, not the trace fold */
  it("joins admission with the outcome into one debit intent", () => {
    const { result, writeDebits } = admitThen(
      GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      outcomeData(),
    );

    expect(result.intents).toHaveLength(1);
    expect(writeDebits).toHaveBeenCalledWith(
      "debits:confirmed",
      expect.objectContaining({
        gateway_request_id: "req_1",
        organization_id: "org_1",
        team_id: "team_1",
        virtual_key_id: "vk_1",
        principal_user_id: "usr_1",
        end_user_id: "user_9",
        status: "confirmed",
        error_type: "",
        cost_nano_usd: 3_500,
        rate_version: "catalog@2026-07-30",
      }),
    );
  });

  /** @scenario One writer owns every scope a request debits */
  it("debits a request that named no end user", () => {
    // The seat templates simply do not resolve; the organization, team,
    // project, key and principal caps are all still owed this request.
    const { result, writeDebits } = admitThen(
      GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      outcomeData(),
      { end_user_id: "" },
    );

    expect(result.intents).toHaveLength(1);
    expect(writeDebits).toHaveBeenCalledWith(
      "debits:confirmed",
      expect.objectContaining({ end_user_id: "", team_id: "team_1" }),
    );
  });

  it("skips a request that moved nothing and keeps an unpriced one", () => {
    // A budget or guardrail rejection: no money, no tokens, no row, and no
    // outbox write, so a rejection storm costs nothing downstream.
    const rejected = admitThen(
      GATEWAY_SPEND_FAILED_EVENT_TYPE,
      outcomeData({
        cost_nano_usd: 0,
        usage: usage(),
        error: { type: "budget_exceeded", http_status: 402 },
      }),
    );
    expect(rejected.result.intents ?? []).toHaveLength(0);
    expect(rejected.writeDebits).not.toHaveBeenCalled();

    // An unpriced model: $0, but real tokens were burned, so the row lands
    // and the budget's activity panel can still show the request happened.
    const unpriced = admitThen(
      GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      outcomeData({ cost_nano_usd: 0, usage: usage({ input_tokens: 12 }) }),
    );
    expect(unpriced.result.intents).toHaveLength(1);
  });

  it("carries the failure taxonomy token onto the debit", () => {
    const blocked = admitThen(
      GATEWAY_SPEND_FAILED_EVENT_TYPE,
      outcomeData({
        error: { type: "guardrail_blocked", http_status: 403 },
        usage: usage({ input_tokens: 40 }),
        cost_nano_usd: 900,
      }),
    );
    expect(blocked.writeDebits).toHaveBeenCalledWith(
      "debits:failed",
      expect.objectContaining({
        status: "failed",
        error_type: "guardrail_blocked",
      }),
    );

    const upstream = admitThen(
      GATEWAY_SPEND_FAILED_EVENT_TYPE,
      outcomeData({
        error: { type: "provider_timeout", http_status: 504 },
        usage: usage({ input_tokens: 40 }),
        cost_nano_usd: 900,
      }),
    );
    expect(upstream.writeDebits).toHaveBeenCalledWith(
      "debits:failed",
      expect.objectContaining({ error_type: "provider_timeout" }),
    );
  });

  /** @scenario An outcome that outruns its admission still debits */
  it("holds an outcome that arrives first and debits when admission lands", () => {
    const { handlers, initial } = capture();
    const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!;
    const confirmed = handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!;

    // The outcome outruns its admit append: nothing to attribute yet.
    const early = ctx();
    const stashed = confirmed(initial(), outcomeData(), early);
    expect(stashed.intents ?? []).toHaveLength(0);
    expect(early.intents.writeDebits).not.toHaveBeenCalled();

    // Admission arrives and releases it, carrying the full attribution.
    const late = ctx();
    const released = admitted(stashed.state, admission(), late);
    expect(released.intents).toHaveLength(1);
    expect(late.intents.writeDebits).toHaveBeenCalledWith(
      "debits:late",
      expect.objectContaining({
        gateway_request_id: "req_1",
        organization_id: "org_1",
        team_id: "team_1",
        principal_user_id: "usr_1",
        end_user_id: "user_9",
        status: "confirmed",
        cost_nano_usd: 3_500,
      }),
    );
  });

  /** @scenario A self-describing admission still releases an outcome that stashed */
  it("releases a stashed outcome when the admission declares outcomes self-describing", () => {
    const { handlers, initial } = capture();
    const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!;
    const confirmed = handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!;

    // An outcome stashes on ITS OWN empty organization, which is a different
    // condition from the build flag below. Where the two disagree, the
    // admission is still the only place the scopes are known.
    const stashed = confirmed(
      initial(),
      outcomeData({ organization_id: "" }),
      ctx(),
    );
    expect(stashed.intents ?? []).toHaveLength(0);

    const c = ctx();
    const released = admitted(
      stashed.state,
      admission({ outcome_carries_attribution: true }),
      c,
    );

    expect(released.intents).toHaveLength(1);
    expect(c.intents.writeDebits).toHaveBeenCalledWith(
      "debits:late",
      expect.objectContaining({
        gateway_request_id: "req_1",
        organization_id: "org_1",
        team_id: "team_1",
        virtual_key_id: "vk_1",
        principal_user_id: "usr_1",
        end_user_id: "user_9",
        status: "confirmed",
      }),
    );
    // Nothing left waiting: this branch is the only thing that could ever
    // clear it, so a stash it dropped would strand the row that holds it.
    // The harness types handler results as `unknown`, hence the cast.
    expect((released.state as GatewayDebitsState).pendingOutcome).toBeNull();
  });

  it("releases an outrunning outcome even when admission names no end user", () => {
    const { handlers, initial } = capture();
    const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!;
    const confirmed = handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!;

    const stashed = confirmed(initial(), outcomeData(), ctx());
    const c = ctx();
    const resolved = admitted(stashed.state, admission({ end_user_id: "" }), c);

    expect(resolved.intents).toHaveLength(1);
    expect(c.intents.writeDebits).toHaveBeenCalledWith(
      "debits:late",
      expect.objectContaining({ end_user_id: "", team_id: "team_1" }),
    );
    expect(logged.error).not.toHaveBeenCalled();
  });

  it("keeps a character-priced call that rated at zero", () => {
    // A model with no rate confirms at $0 with 4000 real characters. Zero
    // cost alone is not the drop test, or that call disappears from the
    // budget's activity panel entirely.
    const { result, writeDebits } = admitThen(
      GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      outcomeData({ usage: usage({ input_chars: 4000 }), cost_nano_usd: 0 }),
    );

    expect(result.intents).toHaveLength(1);
    expect(writeDebits).toHaveBeenCalledWith(
      "debits:confirmed",
      expect.objectContaining({ cost_nano_usd: 0 }),
    );
  });

  it("keeps a call that only spent audio duration", () => {
    const { result } = admitThen(
      GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      outcomeData({ usage: usage({ audio_ms: 60_000 }), cost_nano_usd: 0 }),
    );

    expect(result.intents).toHaveLength(1);
  });

  it("still drops a rejection that moved no money and no quantity", () => {
    const { result, writeDebits } = admitThen(
      GATEWAY_SPEND_FAILED_EVENT_TYPE,
      outcomeData({
        usage: usage(),
        cost_nano_usd: 0,
        error: { type: "budget_exceeded", http_status: 429 },
      }),
    );

    expect(result.intents).toBeUndefined();
    expect(writeDebits).not.toHaveBeenCalled();
  });

  it("reads an intent payload written before the audio quantities existed", () => {
    // An outbox row frozen by the previous build: the quantities it never
    // knew about have to default rather than fail the parse, or the debit is
    // retried eight times and lost.
    const parsed = writeGatewayDebitsSchema.parse({
      gateway_request_id: "req_old",
      project_id: "proj_1",
      organization_id: "org_1",
      virtual_key_id: "vk_1",
      model: "gpt-x",
      model_provider_id: "mp_1",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_tokens: 0,
      },
      cost_nano_usd: 3_500,
      rate_version: "catalog@2026-07-30",
      status: "confirmed",
      duration_ms: 120,
      occurred_at: 1_753_800_000_000,
    });

    expect(parsed.usage).toMatchObject({
      input_tokens: 10,
      input_chars: 0,
      audio_ms: 0,
      input_audio_tokens: 0,
      output_audio_tokens: 0,
      cache_creation_1h_tokens: 0,
    });
  });

  it("reads an intent payload written before the attribution fields existed", () => {
    // An outbox row minted by the previous build, executed by this one: the
    // defaults are what keep it a debit rather than a parse failure.
    const parsed = writeGatewayDebitsSchema.parse({
      gateway_request_id: "req_old",
      project_id: "proj_1",
      organization_id: "org_1",
      virtual_key_id: "vk_1",
      end_user_id: "user_9",
      model: "gpt-x",
      model_provider_id: "mp_1",
      usage: usage({ input_tokens: 10, output_tokens: 5 }),
      cost_nano_usd: 3_500,
      rate_version: "catalog@2026-07-30",
      status: "confirmed",
      duration_ms: 120,
      occurred_at: 1_753_800_000_000,
    });

    expect(parsed).toMatchObject({
      gateway_request_id: "req_old",
      team_id: "",
      principal_user_id: "",
      error_type: "",
    });
  });
});
