import { z } from "zod";
import {
  GatewayDebitPort,
  type GatewayBudgetCrossingCandidate,
  type GatewayBudgetDebitRow,
  type GatewayResolvedBudget,
  type GatewaySpendUsage,
} from "../ports/gateway-debit.port";

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

export class GatewayDebitIntent {
  private constructor(private readonly port: GatewayDebitPort) {}

  static create(port: GatewayDebitPort): GatewayDebitIntent {
    return new GatewayDebitIntent(port);
  }

  async execute(payload: WriteGatewayDebitsPayload): Promise<void> {
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
