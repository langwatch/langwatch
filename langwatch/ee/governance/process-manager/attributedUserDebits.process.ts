// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  AdmitSpendCommandData,
  ConfirmSpendCommandData,
  FailSpendCommandData,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import type { GatewaySpendProcessingEvent } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/events";
import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type {
  BudgetDebitRow,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import {
  budgetAppliesToProvider,
  type ResolvedBudget,
  resolveApplicableBudgets,
} from "~/server/gateway/budgetResolution.service";
import {
  type CrossingCandidateRow,
  detectBudgetCrossings,
} from "../services/governanceSignals.service";

const logger = createLogger("langwatch:governance:attributed-user-debits");

export const ATTRIBUTED_DEBITS_PROCESS_NAME = "attributedUserDebits" as const;

/**
 * Enforcement debits for ATTRIBUTED_USER templates, fed by the spend
 * pipeline. The trace-fold budget reactor cannot write these: the
 * external end-user id travels on the spend commands (admission
 * attribution), never on trace fold state. This process joins admission
 * (who) with the outcome (how much) and writes one ledger debit per
 * matching template into the per-user bucket, which is exactly the read
 * the enforcement bucket-spend endpoint and the scope-totals rollup
 * serve.
 *
 * Ownership split with the trace reactor: this writer owns ONLY
 * ATTRIBUTED_USER budget rows for a request; the reactor owns the rest,
 * and the reactor excludes templates at the source. That split is what
 * keeps the two writers apart, not the per-budget insert probe: the
 * ledger keys rows by (TenantId, BudgetId, GatewayRequestId) with no
 * bucket in the key, so two writers claiming one budget on one request
 * cannot both be recorded whatever the probe does. One of them is
 * dropped, and the spend lands in whichever bucket won.
 */

export interface AttributedDebitsState {
  endUserId: string;
  virtualKeyId: string;
  organizationId: string;
  teamId: string;
  /**
   * Whether the admit event has been folded in. Attribution alone cannot
   * answer that: an admission carrying no end user leaves `endUserId`
   * empty, which reads identically to no admission at all. The two owe
   * opposite things, so the outcome handlers need them apart.
   */
  admitted: boolean;
  /**
   * An outcome this instance saw before its admission. Outcomes can
   * outrun their admit append, and a debit cannot name a bucket without
   * the end user, so the outcome waits here until `admitted` releases it.
   */
  pendingOutcome: WriteAttributedDebitsPayload | null;
  [key: string]: JsonValue;
}

const INITIAL_STATE: AttributedDebitsState = {
  endUserId: "",
  virtualKeyId: "",
  organizationId: "",
  teamId: "",
  admitted: false,
  pendingOutcome: null,
};

export const writeAttributedDebitsSchema = z.object({
  gateway_request_id: z.string(),
  project_id: z.string(),
  organization_id: z.string(),
  virtual_key_id: z.string(),
  end_user_id: z.string(),
  model: z.string(),
  model_provider_id: z.string(),
  usage: z
    .object({
      input_tokens: z.number().int().min(0),
      output_tokens: z.number().int().min(0),
      cache_read_input_tokens: z.number().int().min(0),
      cache_creation_input_tokens: z.number().int().min(0),
      reasoning_tokens: z.number().int().min(0),
    })
    .nullable(),
  /** The price the outcome event carried, in integer nano-USD. */
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string(),
  status: z.enum(["confirmed", "failed"]),
  duration_ms: z.number().int().min(0),
  occurred_at: z.number().int().positive(),
});
export type WriteAttributedDebitsPayload = z.infer<
  typeof writeAttributedDebitsSchema
>;

export interface AttributedDebitsProcessDeps {
  prisma: PrismaClient;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
}

/**
 * The ATTRIBUTED_USER templates this request debits: the end user must
 * have resolved a bucket, and a provider-filtered template only sees its
 * own provider's traffic.
 */
async function resolveAttributedTemplates(
  prisma: PrismaClient,
  payload: WriteAttributedDebitsPayload,
  providerKey: string | null,
): Promise<ResolvedBudget[]> {
  const resolved = await resolveApplicableBudgets(prisma, {
    organizationId: payload.organization_id,
    virtualKeyId: payload.virtual_key_id,
    projectId: payload.project_id,
    endUserId: payload.end_user_id,
  });
  return resolved.filter(
    (r) =>
      r.budget.scopeType === "ATTRIBUTED_USER" &&
      r.endUserId !== null &&
      budgetAppliesToProvider(r.budget, providerKey),
  );
}

/**
 * One ledger debit per matching template, every row carrying the price the
 * outcome event was appended with. An outcome that carries no usage debits
 * zero tokens: the row still lands so the per-request insert probe can see
 * it.
 */
function buildAttributedDebitRows(
  payload: WriteAttributedDebitsPayload,
  templates: ResolvedBudget[],
  providerKey: string | null,
): BudgetDebitRow[] {
  const usage = payload.usage ?? {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_tokens: 0,
  };
  const amountUsd = (payload.cost_nano_usd / NANO_USD_PER_USD).toFixed(6);
  return templates.map((t) => ({
    tenantId: payload.project_id,
    budgetId: t.budget.id,
    scope: t.budget.scopeType,
    scopeId: t.bucketScopeId,
    window: t.budget.window,
    virtualKeyId: payload.virtual_key_id,
    providerKey,
    gatewayRequestId: payload.gateway_request_id,
    amountUsd,
    tokensInput: usage.input_tokens,
    tokensOutput: usage.output_tokens,
    tokensCacheRead: usage.cache_read_input_tokens,
    tokensCacheWrite: usage.cache_creation_input_tokens,
    model: payload.model || "unknown",
    durationMs: payload.duration_ms,
    status: payload.status === "failed" ? "PROVIDER_ERROR" : "SUCCESS",
    occurredAt: new Date(payload.occurred_at),
  }));
}

/**
 * The buckets this request wrote, deduped per (budget, bucket): several
 * templates can land on the same bucket and one crossing read answers for
 * all of them.
 */
function crossingCandidates(
  payload: WriteAttributedDebitsPayload,
  templates: ResolvedBudget[],
): CrossingCandidateRow[] {
  return [
    ...new Map(
      templates.map((t) => [
        `${t.budget.id}:${t.bucketScopeId}`,
        {
          tenantId: payload.project_id,
          budgetId: t.budget.id,
          bucketScopeId: t.bucketScopeId,
          endUserId: payload.end_user_id,
        },
      ]),
    ).values(),
  ];
}

export function runWriteAttributedDebits(deps: AttributedDebitsProcessDeps) {
  return async (payload: WriteAttributedDebitsPayload): Promise<void> => {
    const providerKey = payload.model_provider_id || null;
    const templates = await resolveAttributedTemplates(
      deps.prisma,
      payload,
      providerKey,
    );
    if (templates.length === 0) return;

    try {
      await deps.budgetCHRepository.insertDebitsForBudgets(
        buildAttributedDebitRows(payload, templates, providerKey),
      );
    } catch (error) {
      logger.error(
        {
          projectId: payload.project_id,
          gatewayRequestId: payload.gateway_request_id,
          error,
        },
        "failed to write attributed-user debits",
      );
      // Rethrow for the outbox retry: a lost debit under-enforces the cap.
      throw error;
    }

    // Post-debit crossing detection (threshold/breach webhook families).
    // Best effort inside its own service: a notification can never fail
    // the debit path, and store-level idempotency makes retries safe.
    await detectBudgetCrossings(deps, crossingCandidates(payload, templates));
  };
}

/** The two outcomes a request can reach, each carrying its own command. */
type SpendOutcome =
  | { status: "confirmed"; data: ConfirmSpendCommandData }
  | { status: "failed"; data: FailSpendCommandData };

/**
 * The debit payload for one outcome. A failure still debits whatever
 * tokens the provider billed before erroring. The price rides the event,
 * so a debit always states the figure the spend ledger and the webhook
 * envelope state for the same request.
 */
function writeDebitsPayload(
  state: AttributedDebitsState,
  projectId: string,
  outcome: SpendOutcome,
): WriteAttributedDebitsPayload {
  const { data } = outcome;
  return {
    gateway_request_id: data.gateway_request_id,
    project_id: projectId,
    organization_id: state.organizationId,
    virtual_key_id: state.virtualKeyId,
    end_user_id: state.endUserId,
    model: data.model,
    model_provider_id: data.model_provider_id,
    usage: data.usage,
    cost_nano_usd: data.cost_nano_usd,
    rate_version: data.rate_version,
    status: outcome.status,
    duration_ms: data.duration_ms,
    occurred_at: data.occurred_at,
  };
}

/** What an outcome handler needs from the process context. */
interface OutcomeContext<Intent> {
  projectId: string;
  intents: {
    writeDebits: (key: string, payload: WriteAttributedDebitsPayload) => Intent;
  };
}

/**
 * One outcome, routed by what the instance knows. Before any admission the
 * outcome is stashed for the admitted handler to release. After an
 * admission naming an end user it freezes its debit intent. After one
 * naming nobody there is no bucket to debit, so it commits nothing.
 */
function onOutcome<Intent>(
  state: AttributedDebitsState,
  ctx: OutcomeContext<Intent>,
  outcome: SpendOutcome,
): { state: AttributedDebitsState; intents?: Intent[] } {
  const payload = writeDebitsPayload(state, ctx.projectId, outcome);
  if (!state.admitted) return { state: { ...state, pendingOutcome: payload } };
  if (!state.endUserId) return { state };
  return {
    state,
    intents: [ctx.intents.writeDebits(`debits:${outcome.status}`, payload)],
  };
}

/**
 * One instance per gateway request, like the delivery process: `admitted`
 * stores who the request belonged to, the outcome event freezes one
 * deterministic `writeDebits` intent. An outcome that outruns its
 * admission waits in state until admission releases it, so log order
 * never costs a debit. Requests admitted without an end-user id commit no
 * intent at all, so anchors without templates and traffic without
 * attribution cost nothing here.
 */
export function attributedUserDebitsPM(
  deps: AttributedDebitsProcessDeps,
): ProcessManagerApplier<GatewaySpendProcessingEvent> {
  return (pm) =>
    pm
      .state<AttributedDebitsState>(INITIAL_STATE)
      .intent(
        "writeDebits",
        writeAttributedDebitsSchema,
        runWriteAttributedDebits(deps),
      )
      // Admission carries the end user every debit needs, so it also
      // releases an outcome that arrived ahead of it. One admission per
      // instance keeps `debits:late` minted at most once.
      .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data, ctx) => {
        const admitted = data as AdmitSpendCommandData;
        const endUserId = admitted.end_user_id ?? "";
        const stashed = state.pendingOutcome;
        const next = {
          ...state,
          endUserId,
          virtualKeyId: admitted.virtual_key_id,
          organizationId: admitted.organization_id,
          admitted: true,
          pendingOutcome: null,
        };
        if (!stashed) return { state: next };
        if (!endUserId) {
          // The request was never attributable, so there is no bucket to
          // debit. Loud because a debit reaching here and evaporating is
          // exactly the shape of the loss this process exists to prevent.
          logger.error(
            {
              gatewayRequestId: stashed.gateway_request_id,
              virtualKeyId: admitted.virtual_key_id,
              reason: "admission carried no end user",
            },
            "dropping attributed-user debit: nothing to attribute it to",
          );
          return { state: next };
        }
        return {
          state: next,
          intents: [
            ctx.intents.writeDebits("debits:late", {
              ...stashed,
              organization_id: admitted.organization_id,
              virtual_key_id: admitted.virtual_key_id,
              end_user_id: endUserId,
            }),
          ],
        };
      })
      .on(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, (state, data, ctx) =>
        onOutcome(state, ctx, {
          status: "confirmed",
          data: data as ConfirmSpendCommandData,
        }),
      )
      .on(GATEWAY_SPEND_FAILED_EVENT_TYPE, (state, data, ctx) =>
        onOutcome(state, ctx, {
          status: "failed",
          data: data as FailSpendCommandData,
        }),
      )
      .toPayload((event) => event.data as unknown as JsonValue)
      .outbox({
        maxAttempts: 8,
        concurrency: 4,
        batchSize: 8,
        leaseDurationMs: 120_000,
      });
}
