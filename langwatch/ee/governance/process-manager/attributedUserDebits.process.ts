// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
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
import {
  NANO_USD_PER_USD,
  rateSpendNanoUsd,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { detectBudgetCrossings } from "../services/governanceSignals.service";
import {
  budgetAppliesToProvider,
  resolveApplicableBudgets,
} from "~/server/gateway/budgetResolution.service";

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
 * ATTRIBUTED_USER budget rows for a request; the reactor owns the rest.
 * The insert probes per (BudgetId, GatewayRequestId) so the two writers
 * never suppress each other.
 */

export interface AttributedDebitsState {
  endUserId: string;
  virtualKeyId: string;
  organizationId: string;
  teamId: string;
  [key: string]: JsonValue;
}

const INITIAL_STATE: AttributedDebitsState = {
  endUserId: "",
  virtualKeyId: "",
  organizationId: "",
  teamId: "",
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

export function runWriteAttributedDebits(deps: AttributedDebitsProcessDeps) {
  return async (payload: WriteAttributedDebitsPayload): Promise<void> => {
    const resolved = await resolveApplicableBudgets(deps.prisma, {
      organizationId: payload.organization_id,
      virtualKeyId: payload.virtual_key_id,
      projectId: payload.project_id,
      endUserId: payload.end_user_id,
    });
    const providerKey = payload.model_provider_id || null;
    const templates = resolved.filter(
      (r) =>
        r.budget.scopeType === "ATTRIBUTED_USER" &&
        r.endUserId !== null &&
        budgetAppliesToProvider(r.budget, providerKey),
    );
    if (templates.length === 0) return;

    const usage = payload.usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
    };
    const rated = rateSpendNanoUsd({
      model: payload.model || "unknown",
      usage,
      rateVersion: payload.rate_version,
    });
    const amountUsd = (rated.costNanoUsd / NANO_USD_PER_USD).toFixed(6);

    try {
      await deps.budgetCHRepository.insertDebitsForBudgets(
        templates.map((t) => ({
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
        })),
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
    await detectBudgetCrossings(deps, [
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
    ]);
  };
}

/**
 * One instance per gateway request, like the delivery process: `admitted`
 * stores who the request belonged to, the outcome event freezes one
 * deterministic `writeDebits` intent. Requests with no end-user id never
 * commit an intent at all, so anchors without templates and traffic
 * without attribution cost nothing here.
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
      .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data) => {
        const admitted = data as AdmitSpendCommandData;
        return {
          state: {
            ...state,
            endUserId: admitted.end_user_id ?? "",
            virtualKeyId: admitted.virtual_key_id,
            organizationId: admitted.organization_id,
          },
        };
      })
      .on(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, (state, data, ctx) => {
        if (!state.endUserId) return { state };
        const confirmed = data as ConfirmSpendCommandData;
        return {
          state,
          intents: [
            ctx.intents.writeDebits("debits:confirmed", {
              gateway_request_id: confirmed.gateway_request_id,
              project_id: ctx.projectId,
              organization_id: state.organizationId,
              virtual_key_id: state.virtualKeyId,
              end_user_id: state.endUserId,
              model: confirmed.model,
              model_provider_id: confirmed.model_provider_id,
              usage: confirmed.usage,
              rate_version: confirmed.rate_version,
              status: "confirmed",
              duration_ms: confirmed.duration_ms,
              occurred_at: confirmed.occurred_at,
            }),
          ],
        };
      })
      .on(GATEWAY_SPEND_FAILED_EVENT_TYPE, (state, data, ctx) => {
        if (!state.endUserId) return { state };
        const failed = data as FailSpendCommandData;
        return {
          state,
          intents: [
            ctx.intents.writeDebits("debits:failed", {
              gateway_request_id: failed.gateway_request_id,
              project_id: ctx.projectId,
              organization_id: state.organizationId,
              virtual_key_id: state.virtualKeyId,
              end_user_id: state.endUserId,
              model: failed.model,
              model_provider_id: failed.model_provider_id,
              usage: failed.usage,
              rate_version: "",
              status: "failed",
              duration_ms: failed.duration_ms,
              occurred_at: failed.occurred_at,
            }),
          ],
        };
      })
      .toPayload((event) => event.data as unknown as JsonValue)
      .outbox({
        maxAttempts: 8,
        concurrency: 4,
        batchSize: 8,
        leaseDurationMs: 120_000,
      });
}
