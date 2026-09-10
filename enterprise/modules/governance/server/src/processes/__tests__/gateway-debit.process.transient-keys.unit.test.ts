import { describe, expect, it, vi } from "vitest";
import {
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  type GatewayDebitPort,
} from "../../app/governance.infrastructure.ts";
import { GatewayDebitProcess } from "../gateway-debit.process.ts";

/**
 * The contract the absent transaction rests on.
 *
 * A transient commit has no inbox marker, so a redelivered event is absorbed by
 * the outbox's `(processName, projectId, messageKey)` uniqueness instead. That
 * only works while every key a transient evolution mints is a pure function of
 * the event: a key built from a clock or a random value cannot be re-derived by
 * the redelivery, so the suppression misses and the side effect happens twice.
 */

type Handler = (
  state: unknown,
  data: unknown,
  context: unknown,
) => { state: unknown; intents?: unknown[] };

/** Captures the handlers an applier registers, without a real pipeline. */
function capture(applier: (process: unknown) => unknown) {
  const handlers = new Map<string, Handler>();
  let initial: unknown;
  const builder = {
    state(value: unknown) {
      initial = value;
      return builder;
    },
    intent() {
      return builder;
    },
    on(type: string, fn: Handler) {
      handlers.set(type, fn);
      return builder;
    },
    onWake() {
      return builder;
    },
    schedule() {
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
  applier(builder);
  return { handlers, initial: () => initial };
}

/** A context whose intent factories record the keys they were handed. */
function recordingContext(now: number) {
  return {
    context: {
      projectId: "proj_1",
      key: "req_1",
      at: now,
      now,
      intents: {
        writeDebits: vi.fn((key: string, payload: unknown) => ({ key, payload })),
      },
    },
  };
}

const attribution = {
  organization_id: "org_1",
  virtual_key_id: "vk_1",
  principal_user_id: "user_1",
  team_id: "team_1",
  end_user_id: "end_1",
  trace_id: "trace_1",
  request_type: "chat",
  labels: [],
  metadata: "",
  admitted_at: 1_000,
};

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation_1h_tokens: 0,
  reasoning_tokens: 0,
  input_audio_tokens: 0,
  output_audio_tokens: 0,
  input_chars: 0,
  audio_ms: 0,
};

const confirmed = {
  gateway_request_id: "req_1",
  tenantId: "proj_1",
  occurred_at: 2_000,
  model: "openai/gpt-5",
  model_provider_id: "prov_1",
  usage,
  cost_nano_usd: 1_000,
  rate_version: "catalog@1",
  duration_ms: 100,
  ...attribution,
};

const failed = {
  ...confirmed,
  error: { type: "provider_timeout", http_status: 504 },
};

/** Runs one handler at two different wall clocks and answers both key sets. */
function keysAtTwoClocks(handler: Handler, data: unknown, initial: unknown) {
  const first = recordingContext(10_000);
  handler(initial, data, first.context);
  const second = recordingContext(999_999_999);
  handler(initial, data, second.context);
  return {
    first: first.context.intents.writeDebits.mock.calls.map(([key]) => key),
    second: second.context.intents.writeDebits.mock.calls.map(([key]) => key),
  };
}

describe("transient process message keys", () => {
  describe("given the gateway debits process", () => {
    describe("when the same event is handled at two different wall clocks", () => {
      /** @scenario A transient process mints message keys that a redelivery re-derives exactly */
      it("mints the same keys regardless of wall clock", () => {
        // The handlers under test never reach the port: they mint intents and
        // return, and only the outbox worker would execute one.
        const port = {} as GatewayDebitPort;
        const { handlers, initial } = capture(
          GatewayDebitProcess.create(port).processManager() as unknown as (
            process: unknown,
          ) => unknown,
        );

        for (const [type, data] of [
          [GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, confirmed],
          [GATEWAY_SPEND_FAILED_EVENT_TYPE, failed],
        ] as const) {
          const handler = handlers.get(type);
          expect(handler, `no handler for ${type}`).toBeDefined();
          const { first, second } = keysAtTwoClocks(handler!, data, initial());
          expect(first.length).toBeGreaterThan(0);
          expect(first).toEqual(second);
        }
      });
    });
  });
});
