import type { JsonValue, ProcessManagerApplier } from "@langwatch/eventing";
import { z } from "zod";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GatewayDebitPort,
  type GatewayBudgetCrossingCandidate,
  type GatewayBudgetDebitRow,
  type GatewayResolvedBudget,
  type GatewaySpendAdmittedData,
  type GatewaySpendAttribution,
  type GatewaySpendFailedData,
  type GatewaySpendOutcomeData,
  type GatewaySpendProcessingEvent,
  type GatewaySpendUsage,
} from "../ports/gateway-debit.port";

export const GATEWAY_DEBITS_PROCESS_NAME = "gatewayDebits" as const;

export const writeGatewayDebitsSchema = z.object({
  gateway_request_id: z.string(),
  project_id: z.string(),
  organization_id: z.string(),
  team_id: z.string().default(""),
  virtual_key_id: z.string(),
  principal_user_id: z.string().default(""),
  end_user_id: z.string().default(""),
  model: z.string(),
  model_provider_id: z.string(),
  usage: z
    .object({
      input_tokens: z.number().int().min(0),
      output_tokens: z.number().int().min(0),
      cache_read_input_tokens: z.number().int().min(0),
      cache_creation_input_tokens: z.number().int().min(0),
      cache_creation_1h_tokens: z.number().int().min(0).default(0),
      reasoning_tokens: z.number().int().min(0),
      input_audio_tokens: z.number().int().min(0).default(0),
      output_audio_tokens: z.number().int().min(0).default(0),
      input_chars: z.number().int().min(0).default(0),
      audio_ms: z.number().int().min(0).default(0),
    })
    .nullable(),
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string(),
  status: z.enum(["confirmed", "failed"]),
  error_type: z.string().default(""),
  duration_ms: z.number().int().min(0),
  occurred_at: z.number().int().positive(),
});

export type WriteGatewayDebitsPayload = z.infer<
  typeof writeGatewayDebitsSchema
>;

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

const EMPTY_USAGE: GatewaySpendUsage = {
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
};

export class GatewayDebitsProcessService {
  private constructor(private readonly port: GatewayDebitPort) {}

  static create(port: GatewayDebitPort): GatewayDebitsProcessService {
    return new GatewayDebitsProcessService(port);
  }

  async write(payload: WriteGatewayDebitsPayload): Promise<void> {
    const providerKey = payload.model_provider_id || null;
    const budgets = await this.port.resolve({
      target: {
        organizationId: payload.organization_id,
        teamId: payload.team_id || null,
        projectId: payload.project_id,
        virtualKeyId: payload.virtual_key_id,
        principalUserId: payload.principal_user_id || null,
        endUserId: payload.end_user_id || null,
      },
      providerKey,
    });
    if (budgets.length === 0) return;

    await this.port.insert(this.buildDebitRows(payload, budgets, providerKey));
    await this.port.detectCrossings(this.crossingCandidates(payload, budgets));

    try {
      if (
        !this.affectsEnforcementDecision(budgets) &&
        !(await this.port.shouldEmitBudgetUpdated({
          projectId: payload.project_id,
        }))
      ) {
        return;
      }
      await this.port.emitBudgetUpdated({
        organizationId: payload.organization_id,
        projectId: payload.project_id,
        gatewayRequestId: payload.gateway_request_id,
        virtualKeyId: payload.virtual_key_id,
        budgetIds: budgets.map(({ budget }) => budget.id),
      });
    } catch {
      // Advisory cache invalidation is best effort after the durable debit.
    }
  }

  processManager(): ProcessManagerApplier<GatewaySpendProcessingEvent> {
    return (process) =>
      process
        .state<GatewayDebitsState>(INITIAL_STATE)
        .intent("writeDebits", writeGatewayDebitsSchema, (payload) =>
          this.write(payload),
        )
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

  private attributionFromState(
    state: GatewayDebitsState,
  ): GatewaySpendAttribution {
    return {
      organization_id: state.organizationId,
      team_id: state.teamId,
      virtual_key_id: state.virtualKeyId,
      principal_user_id: state.principalUserId,
      end_user_id: state.endUserId,
    };
  }

  private attributionFromOutcome(
    data: GatewaySpendOutcomeData,
  ): GatewaySpendAttribution | null {
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
      return stashed
        ? { state: { ...state, pendingOutcome: null }, intents: release }
        : { state };
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
    const payload = this.payload(
      this.attributionFromState(state),
      context.projectId,
      outcome,
    );
    return state.admitted
      ? {
          state,
          intents: [
            context.intents.writeDebits(`debits:${outcome.status}`, payload),
          ],
        }
      : { state: { ...state, pendingOutcome: payload } };
  }

  private ledgerStatus(payload: WriteGatewayDebitsPayload) {
    if (payload.status === "confirmed") return "SUCCESS" as const;
    return payload.error_type === "guardrail_blocked"
      ? ("BLOCKED_BY_GUARDRAIL" as const)
      : ("PROVIDER_ERROR" as const);
  }

  private buildDebitRows(
    payload: WriteGatewayDebitsPayload,
    budgets: GatewayResolvedBudget[],
    providerKey: string | null,
  ): GatewayBudgetDebitRow[] {
    const usage = payload.usage ?? EMPTY_USAGE;
    const status = this.ledgerStatus(payload);
    return budgets.map(({ budget, bucketScopeId }) => ({
      tenantId: payload.project_id,
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: bucketScopeId,
      window: budget.window,
      virtualKeyId: payload.virtual_key_id,
      providerKey,
      gatewayRequestId: payload.gateway_request_id,
      amountNanoUsd: payload.cost_nano_usd,
      tokensInput: usage.input_tokens,
      tokensOutput: usage.output_tokens,
      tokensCacheRead: usage.cache_read_input_tokens,
      tokensCacheWrite: usage.cache_creation_input_tokens,
      model: payload.model || "unknown",
      durationMs: payload.duration_ms,
      status,
      occurredAt: new Date(payload.occurred_at),
    }));
  }

  private crossingCandidates(
    payload: WriteGatewayDebitsPayload,
    budgets: GatewayResolvedBudget[],
  ): GatewayBudgetCrossingCandidate[] {
    return [
      ...new Map(
        budgets.map((resolved) => [
          `${resolved.budget.id}:${resolved.bucketScopeId}`,
          {
            tenantId: payload.project_id,
            budgetId: resolved.budget.id,
            bucketScopeId: resolved.bucketScopeId,
            endUserId: resolved.endUserId,
          },
        ]),
      ).values(),
    ];
  }

  private affectsEnforcementDecision(
    budgets: GatewayResolvedBudget[],
  ): boolean {
    return budgets.some(({ budget }) => budget.onBreach === "BLOCK");
  }
}
