import type { ProcessManagerApplier } from "@langwatch/eventing";
import { z } from "zod";

import type { GatewaySpendDebitService } from "../services/gateway-spend-debit.service.ts";
import {
  type WriteGatewayDebitsPayload,
  writeGatewayDebitsSchema,
} from "./gateway-debit.intent.ts";
import type {
  AdmitSpendCommandData,
  ConfirmSpendCommandData,
  FailSpendCommandData,
} from "./gateway-spend-commands.process.ts";
import {
  gatewaySpendAdmittedEventSchema,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  type GatewaySpendProcessingEvent,
} from "./gateway-spend.intent.ts";

/** The registered process name. Instance, inbox and outbox rows key on it. */
export const GATEWAY_DEBITS_PROCESS_NAME = "gatewayDebits" as const;

export const gatewayDebitsStateSchema = z.object({
  endUserId: z.string(),
  virtualKeyId: z.string(),
  organizationId: z.string(),
  teamId: z.string(),
  principalUserId: z.string(),
  admitted: z.boolean(),
  pendingOutcome: writeGatewayDebitsSchema.nullable(),
});
type GatewayDebitsState = z.infer<typeof gatewayDebitsStateSchema>;

/** Who a debit is charged to, from the outcome itself or the admission remembered. */
type DebitAttribution = Pick<
  AdmitSpendCommandData,
  "organization_id" | "team_id" | "virtual_key_id" | "principal_user_id" | "end_user_id"
>;

type SpendOutcome =
  | { status: "confirmed"; data: ConfirmSpendCommandData }
  | { status: "failed"; data: FailSpendCommandData };

type OutcomeContext<Intent> = {
  projectId: string;
  intent: (name: "writeDebits", key: string, payload: WriteGatewayDebitsPayload) => Intent;
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

/**
 * One instance per gateway request: admission says who the request belongs
 * to, the outcome says what it cost, and the pair becomes one debit intent.
 * Transient, so an instance leaves no state once its request has debited.
 */
export class GatewayDebitProcess {
  private constructor(private readonly debits: Pick<GatewaySpendDebitService, "write">) {}

  static create({
    debits,
  }: {
    debits: Pick<GatewaySpendDebitService, "write">;
  }): GatewayDebitProcess {
    return new GatewayDebitProcess(debits);
  }

  processManager(): ProcessManagerApplier<GatewaySpendProcessingEvent> {
    return (process) =>
      process
        .state(gatewayDebitsStateSchema, INITIAL_STATE)
        .intent("writeDebits", writeGatewayDebitsSchema, (payload) => this.debits.write(payload))
        .on(gatewaySpendAdmittedEventSchema, (state, data, context) =>
          this.onAdmission(state, context, data),
        )
        .on(gatewaySpendConfirmedEventSchema, (state, data, context) =>
          this.onOutcome(state, context, { status: "confirmed", data }),
        )
        .on(gatewaySpendFailedEventSchema, (state, data, context) =>
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

  /** Rejections admit and fail at zero; an unpriced model still burned real quantities. */
  private movedNothing(outcome: SpendOutcome): boolean {
    if (outcome.data.cost_nano_usd !== 0) return false;
    return Object.values(outcome.data.usage).every((quantity) => quantity === 0);
  }

  private attributionFromState(state: GatewayDebitsState): DebitAttribution {
    return {
      organization_id: state.organizationId,
      team_id: state.teamId,
      virtual_key_id: state.virtualKeyId,
      principal_user_id: state.principalUserId,
      end_user_id: state.endUserId,
    };
  }

  /** An older gateway build sends outcomes without attribution; the organization tells. */
  private attributionFromOutcome(data: SpendOutcome["data"]): DebitAttribution | null {
    if (!data.organization_id) return null;
    return {
      organization_id: data.organization_id,
      team_id: data.team_id,
      virtual_key_id: data.virtual_key_id,
      principal_user_id: data.principal_user_id,
      end_user_id: data.end_user_id,
    };
  }

  private payload(
    attribution: DebitAttribution,
    projectId: string,
    outcome: SpendOutcome,
  ): WriteGatewayDebitsPayload {
    const { data } = outcome;
    return {
      gateway_request_id: data.gateway_request_id,
      project_id: projectId,
      ...attribution,
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
    admitted: AdmitSpendCommandData,
  ): { state: GatewayDebitsState; intents?: Intent[] } {
    const stashed = state.pendingOutcome;
    const attributed: DebitAttribution = {
      organization_id: admitted.organization_id,
      team_id: admitted.team_id,
      virtual_key_id: admitted.virtual_key_id,
      principal_user_id: admitted.principal_user_id,
      end_user_id: admitted.end_user_id,
    };
    const release = stashed
      ? [context.intent("writeDebits", "debits:late", { ...stashed, ...attributed })]
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
    const key = `debits:${outcome.status}`;
    const stated = this.attributionFromOutcome(outcome.data);
    if (stated) {
      return {
        state,
        intents: [
          context.intent("writeDebits", key, this.payload(stated, context.projectId, outcome)),
        ],
      };
    }
    const payload = this.payload(this.attributionFromState(state), context.projectId, outcome);
    return state.admitted
      ? { state, intents: [context.intent("writeDebits", key, payload)] }
      : { state: { ...state, pendingOutcome: payload } };
  }
}
