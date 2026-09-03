// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The gateway-debits process joins an admission with its outcome into one
 * debit intent. Admission and outcome for the same request can arrive in
 * either order, and either one may carry the attribution — the admission
 * from the control plane's join, or the outcome directly when its build
 * declares outcomes self-describing. Whichever arrives second releases
 * whatever the first one stashed.
 */

import {
  buildProcessDefinition,
  buildProcessManager,
  type ProcessDefinition,
  type ProcessEventEnvelope,
} from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
  type GatewayDebitsState,
} from "../gateway-debit.process";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GatewayDebitPort,
  type GatewayBudgetCrossingCandidate,
  type GatewayBudgetDebitRow,
  type GatewayResolvedBudget,
  type GatewaySpendProcessingEvent,
} from "../../ports/gateway-debit.port";

class StubGatewayDebitPort extends GatewayDebitPort {
  resolve(): Promise<GatewayResolvedBudget[]> {
    return Promise.resolve([]);
  }
  insert(_rows: GatewayBudgetDebitRow[]): Promise<void> {
    return Promise.resolve();
  }
  detectCrossings(_rows: GatewayBudgetCrossingCandidate[]): Promise<void> {
    return Promise.resolve();
  }
  shouldEmitBudgetUpdated(): Promise<boolean> {
    return Promise.resolve(false);
  }
  emitBudgetUpdated(): Promise<void> {
    return Promise.resolve();
  }
}

function processEvent(
  eventType: string,
  payload: ProcessEventEnvelope["payload"],
  occurredAt = 1_000,
): ProcessEventEnvelope {
  return {
    eventId: `${eventType}:${occurredAt}`,
    eventType,
    occurredAt,
    tenantId: "project-1",
    projectId: "project-1",
    processKey: "request-1",
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
  ...overrides,
});

const admission = (overrides: Record<string, unknown> = {}) => ({
  gateway_request_id: "req_1",
  organization_id: "org_1",
  team_id: "team_1",
  virtual_key_id: "vk_1",
  principal_user_id: "usr_1",
  end_user_id: "user_9",
  outcome_carries_attribution: false,
  ...overrides,
});

const outcomeData = (overrides: Record<string, unknown> = {}) => ({
  gateway_request_id: "req_1",
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

function definition(): ProcessDefinition<GatewayDebitsState> {
  const service = GatewayDebitProcess.create(new StubGatewayDebitPort());
  return buildProcessDefinition(
    buildProcessManager<GatewaySpendProcessingEvent>({
      name: GATEWAY_DEBITS_PROCESS_NAME,
      applier: service.processManager(),
    }).config,
  ) as ProcessDefinition<GatewayDebitsState>;
}

const ref = {
  processName: GATEWAY_DEBITS_PROCESS_NAME,
  projectId: "project-1",
  processKey: "req_1",
};

/** Admit, then hand the outcome to the process, returning the intents committed. */
function admitThenOutcome(
  eventType: string,
  outcome: Record<string, unknown>,
  admitOverrides: Record<string, unknown> = {},
) {
  const def = definition();
  const admitted = def.evolve({
    previousState: def.initialState,
    ref,
    input: { kind: "event", now: 1_000, event: processEvent(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, admission(admitOverrides)) },
  });
  return def.evolve({
    previousState: admitted.state,
    ref,
    input: { kind: "event", now: 1_100, event: processEvent(eventType, outcome) },
  });
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
      // An anonymous request owes its organization, team, project, key and
      // principal caps. Only the per-seat templates need an end user, and
      // without one they simply do not resolve.
      const result = admitThenOutcome(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, outcomeData(), {
        end_user_id: "",
      });

      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]?.payload).toMatchObject({
        end_user_id: "",
        team_id: "team_1",
      });
    });
  });

  describe("given an outcome that arrives before its admission", () => {
    /** @scenario An outcome that outruns its admission still debits */
    it("stashes the outcome and commits the debit once admission lands, including for a request naming no end user", () => {
      const def = definition();
      const stashed = def.evolve({
        previousState: def.initialState,
        ref,
        input: {
          kind: "event",
          now: 1_000,
          event: processEvent(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, outcomeData()),
        },
      });
      expect(stashed.intents).toEqual([]);
      expect((stashed.state as GatewayDebitsState).pendingOutcome).not.toBeNull();

      const released = def.evolve({
        previousState: stashed.state,
        ref,
        input: {
          kind: "event",
          now: 1_100,
          event: processEvent(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, admission({ end_user_id: "" })),
        },
      });
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
      // An outcome stashes on ITS OWN empty organization, which is a
      // different condition from the admission's declared flag below. Where
      // the two disagree, the admission is still the only place the scopes
      // are known.
      const def = definition();
      const stashed = def.evolve({
        previousState: def.initialState,
        ref,
        input: {
          kind: "event",
          now: 1_000,
          event: processEvent(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, outcomeData()),
        },
      });
      expect(stashed.intents).toEqual([]);

      const released = def.evolve({
        previousState: stashed.state,
        ref,
        input: {
          kind: "event",
          now: 1_100,
          event: processEvent(
            GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
            admission({ outcome_carries_attribution: true }),
          ),
        },
      });

      expect(released.intents).toHaveLength(1);
      expect(released.intents[0]?.messageKey).toContain("debits:late");
      expect(released.intents[0]?.payload).toMatchObject({
        gateway_request_id: "req_1",
        organization_id: "org_1",
        team_id: "team_1",
        virtual_key_id: "vk_1",
        principal_user_id: "usr_1",
        end_user_id: "user_9",
        status: "confirmed",
      });
      // Nothing left waiting: this branch is the only thing that could ever
      // clear it, so a stash it dropped would strand the row holding it.
      expect((released.state as GatewayDebitsState).pendingOutcome).toBeNull();
    });
  });
});
