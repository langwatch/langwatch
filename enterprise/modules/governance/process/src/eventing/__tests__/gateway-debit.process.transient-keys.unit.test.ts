import {
  buildProcessDefinition,
  buildProcessManager,
  InMemoryProcessStore,
  type JsonValue,
  ProcessManagerService,
} from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  type GatewayBudgetLedger,
} from "../../app/governance.members.ts";
import { GATEWAY_DEBITS_PROCESS_NAME, GatewayDebitProcess } from "../gateway-debit.process.ts";

/**
 * Transient commits rely on outbox uniqueness (no inbox marker), which only works
 * if keys are pure functions of the event. Clock/random keys can't be re-derived.
 */

/** The handlers under test mint intents and return; only the outbox worker would reach this. */
class UnreachedLedger implements GatewayBudgetLedger {
  resolve(): never {
    throw new Error("the ledger is never reached while minting intents");
  }
  insert(): Promise<void> {
    return Promise.reject(new Error("the ledger is never reached while minting intents"));
  }
  detectCrossings(): Promise<void> {
    return Promise.reject(new Error("the ledger is never reached while minting intents"));
  }
  shouldEmitBudgetUpdated = (): Promise<boolean> =>
    Promise.reject(new Error("the ledger is never reached while minting intents"));
  emitBudgetUpdated(): Promise<void> {
    return Promise.reject(new Error("the ledger is never reached while minting intents"));
  }
}

const REF = { processName: GATEWAY_DEBITS_PROCESS_NAME, projectId: "proj_1", processKey: "req_1" };

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
  const manager = new ProcessManagerService({
    definition: buildProcessDefinition(
      buildProcessManager({
        name: REF.processName,
        applier: GatewayDebitProcess.create(new UnreachedLedger()).processManager(),
      }).config,
    ),
    store,
  });
  await manager.handleEvent({
    envelope: {
      eventId: `${eventType}:req_1`,
      eventType,
      occurredAt: 2_000,
      tenantId: REF.projectId,
      projectId: REF.projectId,
      processKey: REF.processKey,
      payload: data,
    },
    now,
  });
  const messages = await store.findMessagesByRef({ ref: REF });
  return messages.map((message) => message.messageKey);
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

describe("transient process message keys", () => {
  describe("given the gateway debits process", () => {
    describe("when the same event is handled at two different wall clocks", () => {
      /** @scenario A transient process mints message keys that a redelivery re-derives exactly */
      it.each([
        [GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, confirmed],
        [GATEWAY_SPEND_FAILED_EVENT_TYPE, failed],
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
