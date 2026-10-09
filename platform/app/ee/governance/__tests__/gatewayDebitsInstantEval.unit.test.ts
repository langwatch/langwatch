// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * An Instant Eval's spend is one confirmed outcome with no admission, no
 * virtual key and no provider. The debits process already takes an outcome
 * that states its own attribution; this pins that the empty key and provider
 * leave the organization, team and project debits intact.
 *
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it, vi } from "vitest";
import { GATEWAY_SPEND_CONFIRMED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { gatewayDebitsPM } from "../process-manager/gatewayDebits.process";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

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

const instantEvalOutcome = () => ({
  gateway_request_id: "instanteval_run_1",
  occurred_at: 1_758_200_000_000,
  tenantId: "proj_1",
  model: "jev",
  model_provider_id: "",
  usage: {
    input_tokens: 2_000,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation_1h_tokens: 0,
    reasoning_tokens: 0,
    input_audio_tokens: 0,
    output_audio_tokens: 0,
    input_chars: 0,
    audio_ms: 0,
    input_image_tokens: 0,
    output_image_tokens: 0,
    image_count: 0,
  },
  rate_version: "instant_eval@0.042x1.3",
  duration_ms: 0,
  organization_id: "org_1",
  virtual_key_id: "",
  end_user_id: "",
  trace_id: "",
  request_type: "instant_eval",
  labels: [],
  metadata: '{"instant_eval":{"cost_usd":0.000084,"requests":40}}',
  admitted_at: 0,
  cost_nano_usd: 109_200,
  principal_user_id: "",
  team_id: "team_1",
});

describe("given an Instant Eval outcome with no virtual key and no provider", () => {
  describe("when the debits process handles it with no admission before it", () => {
    /** @scenario "A project budget sees an Instant Eval outcome" */
    it("freezes one debit intent naming the organization, team and project", () => {
      const { handlers, initial } = capture();
      const writeDebits = vi.fn((key: string, payload: unknown) => ({
        key,
        payload,
      }));

      const result = handlers.get(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE)!(
        initial(),
        instantEvalOutcome(),
        { projectId: "proj_1", intents: { writeDebits } },
      );

      expect(result.intents).toHaveLength(1);
      expect(writeDebits).toHaveBeenCalledWith(
        "debits:confirmed",
        expect.objectContaining({
          gateway_request_id: "instanteval_run_1",
          project_id: "proj_1",
          organization_id: "org_1",
          team_id: "team_1",
          virtual_key_id: "",
          model_provider_id: "",
          model: "jev",
          cost_nano_usd: 109_200,
          status: "confirmed",
        }),
      );
      // Transient: the outcome carried its attribution, so no state is kept.
      expect(result.state).toEqual(initial());
    });
  });
});
