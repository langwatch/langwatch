/**
 * The gateway-debits process joins an admission with its outcome into one
 * debit intent. Either may arrive first and either may carry the attribution;
 * whichever arrives second releases what the first stashed.
 */
import {
  buildProcessDefinition,
  buildProcessManager,
  InMemoryProcessStore,
  type JsonValue,
  type ProcessDefinition,
  type ProcessEventEnvelope,
  ProcessManagerService,
} from "@langwatch/eventing";
import { beforeEach, describe, expect, it } from "vitest";

import type { WriteGatewayDebitsPayload } from "../gateway-debit.intent.ts";
import {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
  gatewayDebitsStateSchema,
} from "../gateway-debit.process.ts";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
} from "../gateway-spend-commands.process.ts";

/** Handlers mint intents and return; only the outbox worker would reach the writer. */
const unreachedWriter = {
  write: (_payload: WriteGatewayDebitsPayload): Promise<void> =>
    Promise.reject(new Error("the writer is never reached while minting intents")),
};

function applier() {
  return GatewayDebitProcess.create({ debits: unreachedWriter }).processManager();
}

function definition(): ProcessDefinition<unknown> {
  return buildProcessDefinition(
    buildProcessManager({ name: GATEWAY_DEBITS_PROCESS_NAME, applier: applier() }).config,
  );
}

const ref = {
  processName: GATEWAY_DEBITS_PROCESS_NAME,
  projectId: "project-1",
  processKey: "req_1",
};

function processEvent(
  eventType: string,
  payload: JsonValue,
  occurredAt = 1_000,
): ProcessEventEnvelope {
  return {
    eventId: `${eventType}:${occurredAt}`,
    eventType,
    occurredAt,
    tenantId: "project-1",
    projectId: "project-1",
    processKey: "req_1",
    payload,
  };
}

const usage = (overrides: Record<string, number> = {}) => ({
  input_tokens: 0,
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
  ...overrides,
});

const admission = (overrides: Record<string, JsonValue> = {}) => ({
  gateway_request_id: "req_1",
  occurred_at: 1_753_800_000_000,
  tenantId: "project-1",
  model: "gpt-x",
  organization_id: "org_1",
  team_id: "team_1",
  virtual_key_id: "vk_1",
  principal_user_id: "usr_1",
  end_user_id: "user_9",
  outcome_carries_attribution: false,
  ...overrides,
});

const outcomeData = (overrides: Record<string, JsonValue> = {}) => ({
  gateway_request_id: "req_1",
  tenantId: "project-1",
  organization_id: "",
  team_id: "",
  virtual_key_id: "",
  principal_user_id: "",
  end_user_id: "",
  model: "gpt-x",
  model_provider_id: "mp_1",
  usage: usage({ input_tokens: 10, output_tokens: 5 }),
  cost_nano_usd: 3_500,
  rate_version: "catalog@2026-07-30",
  duration_ms: 120,
  occurred_at: 1_753_800_000_000,
  ...overrides,
});

function evolve(
  def: ProcessDefinition<unknown>,
  previousState: unknown,
  event: ProcessEventEnvelope,
  now = 1_000,
) {
  return def.evolve({ previousState, ref, input: { kind: "event", now, event } });
}

/** Admit, then hand the outcome to the process, returning what the outcome committed. */
function admitThenOutcome(
  eventType: string,
  outcome: Record<string, JsonValue>,
  admitOverrides: Record<string, JsonValue> = {},
) {
  const def = definition();
  const admitted = evolve(
    def,
    def.initialState,
    processEvent(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, admission(admitOverrides)),
  );
  return evolve(def, admitted.state, processEvent(eventType, outcome), 1_100);
}

describe("gateway debits process", () => {
  describe("given attribution already resolved by admission", () => {
    /** @scenario Attributed debits ride the spend pipeline, not the trace fold */
    it("joins admission with the outcome into one debit intent", () => {
      const result = admitThenOutcome(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, outcomeData());

      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]?.payload).toMatchObject({
        gateway_request_id: "req_1",
        organization_id: "org_1",
        team_id: "team_1",
        virtual_key_id: "vk_1",
        principal_user_id: "usr_1",
        end_user_id: "user_9",
        status: "confirmed",
        cost_nano_usd: 3_500,
        rate_version: "catalog@2026-07-30",
      });
    });

    /** @scenario One writer owns every scope a request debits */
    it("still commits one debit intent for a request admitted without an end user", () => {
      const result = admitThenOutcome(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, outcomeData(), {
        end_user_id: "",
      });

      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]?.payload).toMatchObject({ end_user_id: "", team_id: "team_1" });
    });

    it("carries a failed outcome's error type for the ledger status", () => {
      const result = admitThenOutcome(
        GATEWAY_SPEND_FAILED_EVENT_TYPE,
        outcomeData({ error: { type: "guardrail_blocked", http_status: 403 } }),
      );

      expect(result.intents[0]?.payload).toMatchObject({
        status: "failed",
        error_type: "guardrail_blocked",
      });
    });
  });

  describe("given an admission whose outcome has not arrived", () => {
    /** @scenario An admission without an outcome debits nothing */
    it("commits no debit and remembers who the request belongs to", () => {
      const def = definition();
      const admitted = evolve(
        def,
        def.initialState,
        processEvent(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, admission()),
      );

      expect(admitted.intents).toEqual([]);
      expect(gatewayDebitsStateSchema.parse(admitted.state)).toMatchObject({
        admitted: true,
        organizationId: "org_1",
        virtualKeyId: "vk_1",
        pendingOutcome: null,
      });
    });

    /** @scenario An admission without an outcome debits nothing */
    it("commits no debit for an outcome that moved no money and no quantity", () => {
      const result = admitThenOutcome(
        GATEWAY_SPEND_FAILED_EVENT_TYPE,
        outcomeData({ cost_nano_usd: 0, usage: usage(), error: { type: "budget_exceeded" } }),
      );

      expect(result.intents).toEqual([]);
    });

    it("still debits an unpriced outcome that burned real characters", () => {
      const result = admitThenOutcome(
        GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        outcomeData({ cost_nano_usd: 0, usage: usage({ input_chars: 4_000 }) }),
      );

      expect(result.intents).toHaveLength(1);
    });
  });

  describe("given an outcome that arrives before its admission", () => {
    let def: ProcessDefinition<unknown>;
    let stashed: ReturnType<ProcessDefinition<unknown>["evolve"]>;

    beforeEach(() => {
      def = definition();
      stashed = evolve(
        def,
        def.initialState,
        processEvent(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, outcomeData()),
      );
    });

    /** @scenario An outcome that outruns its admission still debits */
    it("stashes the outcome and commits the debit once admission lands, including for a request naming no end user", () => {
      expect(stashed.intents).toEqual([]);
      expect(gatewayDebitsStateSchema.parse(stashed.state).pendingOutcome).not.toBeNull();

      const released = evolve(
        def,
        stashed.state,
        processEvent(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, admission({ end_user_id: "" })),
        1_100,
      );
      expect(released.intents).toHaveLength(1);
      expect(released.intents[0]?.messageKey).toContain("debits:late");
      expect(released.intents[0]?.payload).toMatchObject({
        gateway_request_id: "req_1",
        organization_id: "org_1",
        team_id: "team_1",
        end_user_id: "",
        status: "confirmed",
        cost_nano_usd: 3_500,
      });
    });

    /** @scenario A self-describing admission still releases an outcome that stashed */
    it("releases a stashed outcome when the admission declares outcomes self-describing", () => {
      const released = evolve(
        def,
        stashed.state,
        processEvent(
          GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
          admission({ outcome_carries_attribution: true }),
        ),
        1_100,
      );

      expect(released.intents).toHaveLength(1);
      expect(released.intents[0]?.messageKey).toContain("debits:late");
      expect(released.intents[0]?.payload).toMatchObject({
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        end_user_id: "user_9",
      });
      // This branch is the only thing that could clear the stash.
      expect(gatewayDebitsStateSchema.parse(released.state).pendingOutcome).toBeNull();
    });
  });
});

/** Handles one event on a fresh store at `now`, and answers the outbox keys it minted. */
async function keysMintedAt({
  eventType,
  data,
  now,
}: {
  eventType: string;
  data: JsonValue;
  now: number;
}): Promise<string[]> {
  const store = InMemoryProcessStore.createForTesting();
  const manager = new ProcessManagerService({ definition: definition(), store });
  await manager.handleEvent({ envelope: processEvent(eventType, data, 2_000), now });
  const messages = await store.findMessagesByRef({ ref });
  return messages.map((message) => message.messageKey);
}

const selfDescribing = outcomeData({
  organization_id: "org_1",
  virtual_key_id: "vk_1",
  principal_user_id: "user_1",
  team_id: "team_1",
  end_user_id: "end_1",
});

describe("transient process message keys", () => {
  describe("given the gateway debits process", () => {
    describe("when the same event is handled at two different wall clocks", () => {
      /** @scenario A transient process mints message keys that a redelivery re-derives exactly */
      it.each([
        [GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, selfDescribing],
        [
          GATEWAY_SPEND_FAILED_EVENT_TYPE,
          { ...selfDescribing, error: { type: "provider_timeout", http_status: 504 } },
        ],
      ] as const)(
        "mints the same keys for %s regardless of wall clock",
        async (eventType, data) => {
          const first = await keysMintedAt({ eventType, data, now: 10_000 });
          const second = await keysMintedAt({ eventType, data, now: 999_999_999 });
          expect(first.length).toBeGreaterThan(0);
          expect(first).toEqual(second);
        },
      );
    });
  });
});
