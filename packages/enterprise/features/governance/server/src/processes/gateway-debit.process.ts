import type { JsonValue, ProcessManagerApplier } from "@langwatch/eventing";
import {
  GatewayDebitIntent,
  type WriteGatewayDebitsPayload,
  writeGatewayDebitsSchema,
} from "../intents/gateway-debit.intent";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GatewayDebitPort,
  type GatewaySpendAdmittedData,
  type GatewaySpendAttribution,
  type GatewaySpendFailedData,
  type GatewaySpendOutcomeData,
  type GatewaySpendProcessingEvent,
} from "../ports/gateway-debit.port";

export const GATEWAY_DEBITS_PROCESS_NAME = "gatewayDebits" as const;

export interface GatewayDebitsState {
  endUserId: string;
  virtualKeyId: string;
  organizationId: string;
  teamId: string;
  principalUserId: string;
  admitted: boolean;
  pendingOutcome: WriteGatewayDebitsPayload | null;
  [key: string]: JsonValue;
}

type SpendOutcome =
  | { status: "confirmed"; data: GatewaySpendOutcomeData }
  | { status: "failed"; data: GatewaySpendFailedData };

type OutcomeContext<Intent> = {
  projectId: string;
  intents: {
    writeDebits: (key: string, payload: WriteGatewayDebitsPayload) => Intent;
  };
};

const INITIAL_STATE: GatewayDebitsState = {
  endUserId: "",
  virtualKeyId: "",
  organizationId: "",
  teamId: "",
  principalUserId: "",
  admitted: false,
  pendingOutcome: null,
};

export class GatewayDebitProcess {
  private constructor(private readonly intent: GatewayDebitIntent) {}

  static create(port: GatewayDebitPort): GatewayDebitProcess {
    return new GatewayDebitProcess(GatewayDebitIntent.create(port));
  }

  processManager(): ProcessManagerApplier<GatewaySpendProcessingEvent> {
    return (process) =>
      process
        .state<GatewayDebitsState>(INITIAL_STATE)
        .intent("writeDebits", writeGatewayDebitsSchema, (payload) => this.intent.execute(payload))
        .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data, context) =>
          this.onAdmission(state, context, data),
        )
        .on(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, (state, data, context) =>
          this.onOutcome(state, context, { status: "confirmed", data }),
        )
        .on(GATEWAY_SPEND_FAILED_EVENT_TYPE, (state, data, context) =>
          this.onOutcome(state, context, { status: "failed", data }),
        )
        .transient()
        .outbox({
          maxAttempts: 8,
          concurrency: 4,
          batchSize: 8,
          leaseDurationMs: 120_000,
        });
  }

  private movedNothing(outcome: SpendOutcome): boolean {
    if (outcome.data.cost_nano_usd !== 0) return false;
    const usage = outcome.data.usage;
    if (!usage) return true;
    return Object.values(usage).every((quantity) => quantity === 0);
  }

  private attributionFromState(state: GatewayDebitsState): GatewaySpendAttribution {
    return {
      organization_id: state.organizationId,
      team_id: state.teamId,
      virtual_key_id: state.virtualKeyId,
      principal_user_id: state.principalUserId,
      end_user_id: state.endUserId,
    };
  }

  private attributionFromOutcome(data: GatewaySpendOutcomeData): GatewaySpendAttribution | null {
    return data.organization_id ? data : null;
  }

  private payload(
    attribution: GatewaySpendAttribution,
    projectId: string,
    outcome: SpendOutcome,
  ): WriteGatewayDebitsPayload {
    const { data } = outcome;
    return {
      gateway_request_id: data.gateway_request_id,
      project_id: projectId,
      organization_id: attribution.organization_id,
      team_id: attribution.team_id,
      virtual_key_id: attribution.virtual_key_id,
      principal_user_id: attribution.principal_user_id,
      end_user_id: attribution.end_user_id,
      model: data.model,
      model_provider_id: data.model_provider_id,
      usage: data.usage,
      cost_nano_usd: data.cost_nano_usd,
      rate_version: data.rate_version,
      status: outcome.status,
      error_type: outcome.status === "failed" ? outcome.data.error.type : "",
      duration_ms: data.duration_ms,
      occurred_at: data.occurred_at,
    };
  }

  private onAdmission<Intent>(
    state: GatewayDebitsState,
    context: OutcomeContext<Intent>,
    admitted: GatewaySpendAdmittedData,
  ): { state: GatewayDebitsState; intents?: Intent[] } {
    const stashed = state.pendingOutcome;
    const attributed = {
      organization_id: admitted.organization_id,
      team_id: admitted.team_id ?? "",
      virtual_key_id: admitted.virtual_key_id,
      principal_user_id: admitted.principal_user_id ?? "",
      end_user_id: admitted.end_user_id ?? "",
    };
    const release = stashed
      ? [
          context.intents.writeDebits("debits:late", {
            ...stashed,
            ...attributed,
          }),
        ]
      : undefined;
    if (admitted.outcome_carries_attribution) {
      return stashed ? { state: { ...state, pendingOutcome: null }, intents: release } : { state };
    }
    const next = {
      ...state,
      endUserId: attributed.end_user_id,
      virtualKeyId: attributed.virtual_key_id,
      organizationId: attributed.organization_id,
      teamId: attributed.team_id,
      principalUserId: attributed.principal_user_id,
      admitted: true,
      pendingOutcome: null,
    };
    return stashed ? { state: next, intents: release } : { state: next };
  }

  private onOutcome<Intent>(
    state: GatewayDebitsState,
    context: OutcomeContext<Intent>,
    outcome: SpendOutcome,
  ): { state: GatewayDebitsState; intents?: Intent[] } {
    if (this.movedNothing(outcome)) return { state };
    const stated = this.attributionFromOutcome(outcome.data);
    if (stated) {
      return {
        state,
        intents: [
          context.intents.writeDebits(
            `debits:${outcome.status}`,
            this.payload(stated, context.projectId, outcome),
          ),
        ],
      };
    }
    const payload = this.payload(this.attributionFromState(state), context.projectId, outcome);
    return state.admitted
      ? {
          state,
          intents: [context.intents.writeDebits(`debits:${outcome.status}`, payload)],
        }
      : { state: { ...state, pendingOutcome: payload } };
  }
}
