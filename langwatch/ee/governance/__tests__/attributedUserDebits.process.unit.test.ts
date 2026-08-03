// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { attributedUserDebitsPM } from "../process-manager/attributedUserDebits.process";

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
  };
  attributedUserDebitsPM({
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

const outcomeData = (requestId: string) => ({
  gateway_request_id: requestId,
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
  duration_ms: 120,
  occurred_at: 1_753_800_000_000,
});

describe("attributed-user debits process", () => {
  beforeEach(() => vi.clearAllMocks());
  /** @scenario Attributed debits ride the spend pipeline, not the trace fold */
  it("joins admission with the outcome, and skips requests without an end user", () => {
    const { handlers, initial } = capture();
    const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!;
    const confirmed = handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!;

    const withUser = admitted(
      initial(),
      {
        gateway_request_id: "req_1",
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        end_user_id: "user_9",
      },
      ctx(),
    );
    const c1 = ctx();
    const out = confirmed(
      withUser.state,
      {
        gateway_request_id: "req_1",
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
        duration_ms: 120,
        occurred_at: 1_753_800_000_000,
      },
      c1,
    );
    expect(out.intents).toHaveLength(1);
    expect(c1.intents.writeDebits).toHaveBeenCalledWith(
      "debits:confirmed",
      expect.objectContaining({
        gateway_request_id: "req_1",
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        end_user_id: "user_9",
        status: "confirmed",
        cost_nano_usd: 3_500,
        rate_version: "catalog@2026-07-30",
      }),
    );

    // No end user on admission: the outcome never commits an intent.
    const withoutUser = admitted(
      initial(),
      {
        gateway_request_id: "req_2",
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        end_user_id: "",
      },
      ctx(),
    );
    const c2 = ctx();
    const silent = confirmed(
      withoutUser.state,
      {
        gateway_request_id: "req_2",
        usage: null,
        cost_nano_usd: 0,
        rate_version: "",
        model: "gpt-x",
        model_provider_id: "",
        duration_ms: 1,
        occurred_at: 1,
      },
      c2,
    );
    expect(silent.intents ?? []).toHaveLength(0);
    expect(c2.intents.writeDebits).not.toHaveBeenCalled();
  });

  /** @scenario An outcome that outruns its admission still debits */
  it("holds an outcome that arrives first and debits when admission lands", () => {
    const { handlers, initial } = capture();
    const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!;
    const confirmed = handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!;

    // The outcome outruns its admit append: nothing to attribute yet.
    const early = ctx();
    const stashed = confirmed(initial(), outcomeData("req_late"), early);
    expect(stashed.intents ?? []).toHaveLength(0);
    expect(early.intents.writeDebits).not.toHaveBeenCalled();

    // Admission arrives and releases it.
    const late = ctx();
    const released = admitted(
      stashed.state,
      {
        gateway_request_id: "req_late",
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        end_user_id: "user_9",
      },
      late,
    );
    expect(released.intents).toHaveLength(1);
    expect(late.intents.writeDebits).toHaveBeenCalledWith(
      "debits:late",
      expect.objectContaining({
        gateway_request_id: "req_late",
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        end_user_id: "user_9",
        status: "confirmed",
        cost_nano_usd: 3_500,
      }),
    );
  });

  it("drops an outrunning outcome loudly when admission names nobody", () => {
    const { handlers, initial } = capture();
    const admitted = handlers.get(GATEWAY_SPEND_ADMITTED_EVENT_TYPE)!;
    const confirmed = handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!;

    const stashed = confirmed(initial(), outcomeData("req_orphan"), ctx());
    const c = ctx();
    const resolved = admitted(
      stashed.state,
      {
        gateway_request_id: "req_orphan",
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        end_user_id: "",
      },
      c,
    );

    expect(resolved.intents ?? []).toHaveLength(0);
    expect(c.intents.writeDebits).not.toHaveBeenCalled();
    expect(logged.error).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayRequestId: "req_orphan",
        reason: "admission carried no end user",
      }),
      expect.stringContaining("dropping attributed-user debit"),
    );
  });
});
