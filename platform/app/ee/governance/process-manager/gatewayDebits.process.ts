// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { GatewayBudgetLedgerStatus, PrismaClient } from "@prisma/client";
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
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type {
  BudgetDebitRow,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import type { BudgetChangeEventDedupeService } from "~/server/gateway/budgetChangeEventDedupe.service";
import {
  budgetAppliesToProvider,
  type ResolvedBudget,
  resolveApplicableBudgets,
} from "~/server/gateway/budgetResolution.service";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import {
  type CrossingCandidateRow,
  detectBudgetCrossings,
} from "../services/governanceSignals.service";

const logger = createLogger("langwatch:governance:gateway-debits");

/** The registered process name. Instance, inbox and outbox rows key on it. */
export const GATEWAY_DEBITS_PROCESS_NAME = "gatewayDebits" as const;

/**
 * The sole writer of gateway budget debits.
 *
 * One instance per gateway request, fed by the spend commands the gateway
 * emits: admission says who the request belonged to, the outcome says what
 * it cost, and this joins the two into one ledger row per applicable
 * budget. Every scope debits from here, whether or not the request named an
 * end user: an anonymous request still owes its organization, team,
 * project, key, principal and group caps, and an attributed one owes the
 * per-seat templates its end user resolves a bucket for on top.
 *
 * The spend commands see strictly more than the trace this work used to
 * ride on. Admission fires before any gating, so a request a budget or a
 * guardrail refused is a record rather than a silence; the grain is the
 * request rather than the trace, so a trace carrying several requests
 * debits each of them; and the price rides the event, so the ledger row,
 * the spend record and the webhook envelope cannot disagree about what one
 * request cost.
 */

export interface GatewayDebitsState {
  endUserId: string;
  virtualKeyId: string;
  organizationId: string;
  teamId: string;
  principalUserId: string;
  /**
   * Whether the admit event has been folded in. Attribution alone cannot
   * answer that: an admission carrying no end user leaves `endUserId`
   * empty, which reads identically to no admission at all. The two owe
   * opposite things, so the outcome handlers need them apart.
   */
  admitted: boolean;
  /**
   * An outcome this instance saw before its admission. Outcomes can
   * outrun their admit append, and a debit cannot name its scopes without
   * the attribution, so the outcome waits here until `admitted` releases
   * it.
   */
  pendingOutcome: WriteGatewayDebitsPayload | null;
  [key: string]: JsonValue;
}

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
 * Every field added since the first deploy carries a default. An intent is
 * a durable outbox row, so a payload written by the previous build is read
 * back by this one, and a field without a default turns that row into a
 * permanent parse failure instead of a debit.
 */
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
      reasoning_tokens: z.number().int().min(0),
    })
    .nullable(),
  /** The price the outcome event carried, in integer nano-USD. */
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string(),
  status: z.enum(["confirmed", "failed"]),
  /** The gateway's own taxonomy token on a failure, empty on a success. A
   *  guardrail block is the one class the ledger records under its own
   *  status rather than as a provider error. */
  error_type: z.string().default(""),
  duration_ms: z.number().int().min(0),
  occurred_at: z.number().int().positive(),
});
export type WriteGatewayDebitsPayload = z.infer<
  typeof writeGatewayDebitsSchema
>;

export interface GatewayDebitsProcessDeps {
  prisma: PrismaClient;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  /**
   * Gates redundant advisory BUDGET_UPDATED emissions. Optional: without it
   * every debit emits, which is what this process did before the dedupe
   * existed.
   */
  changeEventDedupe?: BudgetChangeEventDedupeService;
}

/**
 * Every budget this request debits. The attribution all rides the payload,
 * so one resolve answers for all scopes, and a provider-filtered budget
 * only sees the traffic its own provider served.
 */
async function resolveDebitedBudgets(
  prisma: PrismaClient,
  payload: WriteGatewayDebitsPayload,
  providerKey: string | null,
): Promise<ResolvedBudget[]> {
  const resolved = await resolveApplicableBudgets(prisma, {
    organizationId: payload.organization_id,
    teamId: payload.team_id || null,
    projectId: payload.project_id,
    virtualKeyId: payload.virtual_key_id,
    principalUserId: payload.principal_user_id || null,
    endUserId: payload.end_user_id || null,
  });
  return resolved.filter((r) => budgetAppliesToProvider(r.budget, providerKey));
}

/**
 * What the ledger records this request as. A guardrail block is its own
 * status because it is the gateway's own refusal rather than an upstream
 * failure, and it only became reachable once rejections started emitting
 * spend commands: a pre-block never produced a trace at all.
 *
 * Only SUCCESS rows accrue enforcement spend. The others are the visible
 * record that the attempt happened.
 */
function ledgerStatus(
  payload: WriteGatewayDebitsPayload,
): GatewayBudgetLedgerStatus {
  if (payload.status === "confirmed") return "SUCCESS";
  return payload.error_type === "guardrail_blocked"
    ? "BLOCKED_BY_GUARDRAIL"
    : "PROVIDER_ERROR";
}

/**
 * One ledger debit per applicable budget, every row carrying the price the
 * outcome event was appended with.
 */
function buildDebitRows(
  payload: WriteGatewayDebitsPayload,
  budgets: ResolvedBudget[],
  providerKey: string | null,
): BudgetDebitRow[] {
  const usage = payload.usage ?? {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_tokens: 0,
  };
  // The outcome was priced once, as an integer. It stays one all the way to
  // the ledger: dividing by 1e9 to six decimals here rounded every debit to
  // the nearest micro-USD before it was ever summed, and the error compounded
  // per request rather than cancelling.
  const amountNanoUsd = payload.cost_nano_usd;
  const status = ledgerStatus(payload);
  return budgets.map((b) => ({
    tenantId: payload.project_id,
    budgetId: b.budget.id,
    scope: b.budget.scopeType,
    scopeId: b.bucketScopeId,
    window: b.budget.window,
    virtualKeyId: payload.virtual_key_id,
    providerKey,
    gatewayRequestId: payload.gateway_request_id,
    amountNanoUsd,
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

/**
 * The buckets this request wrote, deduped per (budget, bucket): several
 * budgets can land on the same bucket and one crossing read answers for
 * all of them. Only a per-seat template's bucket belongs to an end user;
 * every other scope's crossing is about the scope itself.
 */
function crossingCandidates(
  payload: WriteGatewayDebitsPayload,
  budgets: ResolvedBudget[],
): CrossingCandidateRow[] {
  return [
    ...new Map(
      budgets.map((b) => [
        `${b.budget.id}:${b.bucketScopeId}`,
        {
          tenantId: payload.project_id,
          budgetId: b.budget.id,
          bucketScopeId: b.bucketScopeId,
          endUserId: b.endUserId,
        },
      ]),
    ).values(),
  ];
}

/**
 * Whether a debit against these budgets can change an enforcement decision.
 *
 * A BLOCK budget's spend feeds the gateway's pre-request precheck, so its
 * change event has to reach the gateway promptly or an over-limit key keeps
 * being served from a cached bundle. A WARN budget's spend only drives
 * advisory signal, where the same delay costs freshness and nothing else.
 *
 * That asymmetry is the whole basis for deduping one and not the other:
 * they are not the same currency, and a single window cannot price both.
 */
function affectsEnforcementDecision(budgets: ResolvedBudget[]): boolean {
  return budgets.some(({ budget }) => budget.onBreach === "BLOCK");
}

/**
 * Tell the gateway its cached spend is stale, so the next request on this
 * project re-resolves rather than enforcing against the figure baked in at
 * bundle time. Narrow by project: an org-wide eviction would cold-miss
 * every other project's keys over one request's debit.
 *
 * One instance runs per gateway request, so an ungated emit puts one change
 * event on the feed per billable request, and every one of them evicts every
 * bundle in the project: an L1 sweep plus a cold miss for each other virtual
 * key in it. The emissions are redundant with each other because the event
 * carries no spend figure. It asks for an eviction, and the re-materialise it
 * provokes reads current spend for every budget, so one eviction per window
 * achieves what N did.
 *
 * The dedupe is skipped entirely when any applicable budget blocks on breach,
 * so an emission that could change an enforcement decision is never held
 * back. That is why the window cannot become the dominant term in
 * block-decision propagation: it is not on that path at all.
 *
 * Known limit, deliberate: this is a leading-edge window with no trailing
 * flush. If advisory traffic stops mid-window, the last debit's refresh waits
 * for the next debit or the bundle TTL. That is acceptable for a signal
 * nothing enforces on, and it cannot happen on the blocking path.
 *
 * Best effort. The ledger rows already landed, and a missed eviction costs
 * freshness until the config TTL rolls, never correctness.
 */
async function emitBudgetUpdated(
  deps: GatewayDebitsProcessDeps,
  payload: WriteGatewayDebitsPayload,
  budgets: ResolvedBudget[],
): Promise<void> {
  try {
    if (deps.changeEventDedupe && !affectsEnforcementDecision(budgets)) {
      const emit = await deps.changeEventDedupe.shouldEmit({
        projectId: payload.project_id,
      });
      if (!emit) return;
    }

    await new ChangeEventRepository(deps.prisma).append({
      organizationId: payload.organization_id,
      projectId: payload.project_id,
      kind: "BUDGET_UPDATED",
      payload: {
        gatewayRequestId: payload.gateway_request_id,
        virtualKeyId: payload.virtual_key_id,
        budgetIds: budgets.map((b) => b.budget.id),
      },
    });
  } catch (error) {
    logger.warn(
      {
        projectId: payload.project_id,
        virtualKeyId: payload.virtual_key_id,
        gatewayRequestId: payload.gateway_request_id,
        error,
      },
      "failed to emit BUDGET_UPDATED change event after debiting",
    );
  }
}

export function runWriteGatewayDebits(deps: GatewayDebitsProcessDeps) {
  return async (payload: WriteGatewayDebitsPayload): Promise<void> => {
    const providerKey = payload.model_provider_id || null;
    const budgets = await resolveDebitedBudgets(
      deps.prisma,
      payload,
      providerKey,
    );
    if (budgets.length === 0) return;

    try {
      await deps.budgetCHRepository.insertDebitsForBudgets(
        buildDebitRows(payload, budgets, providerKey),
      );
    } catch (error) {
      logger.error(
        {
          projectId: payload.project_id,
          gatewayRequestId: payload.gateway_request_id,
          error,
        },
        "failed to write gateway budget debits",
      );
      // Rethrow for the outbox retry: a lost debit under-enforces the cap.
      throw error;
    }

    // Post-debit crossing detection (threshold/breach webhook families).
    // Best effort inside its own service: a notification can never fail
    // the debit path, and store-level idempotency makes retries safe.
    await detectBudgetCrossings(deps, crossingCandidates(payload, budgets));

    await emitBudgetUpdated(deps, payload, budgets);
  };
}

/** The two outcomes a request can reach, each carrying its own command. */
type SpendOutcome =
  | { status: "confirmed"; data: ConfirmSpendCommandData }
  | { status: "failed"; data: FailSpendCommandData };

/**
 * A request that moved no money and burned no tokens. Rejections are the
 * bulk of these: a budget or guardrail refusal admits and fails at zero,
 * and minting an outbox row for each would turn a rejection storm into
 * write amplification behind ledger rows that sum to nothing.
 *
 * Zero cost alone is not the test. An unpriced model confirms at $0 with
 * real tokens, and those rows are what a budget's activity panel shows, so
 * they still get written.
 */
function movedNothing(outcome: SpendOutcome): boolean {
  if (outcome.data.cost_nano_usd !== 0) return false;
  const usage = outcome.data.usage;
  if (!usage) return true;
  return (
    usage.input_tokens === 0 &&
    usage.output_tokens === 0 &&
    usage.cache_read_input_tokens === 0 &&
    usage.cache_creation_input_tokens === 0 &&
    usage.reasoning_tokens === 0
  );
}

/**
 * The debit payload for one outcome. A failure still debits whatever
 * tokens the provider billed before erroring. The price rides the event,
 * so a debit always states the figure the spend ledger and the webhook
 * envelope state for the same request.
 */
function writeDebitsPayload(
  state: GatewayDebitsState,
  projectId: string,
  outcome: SpendOutcome,
): WriteGatewayDebitsPayload {
  const { data } = outcome;
  return {
    gateway_request_id: data.gateway_request_id,
    project_id: projectId,
    organization_id: state.organizationId,
    team_id: state.teamId,
    virtual_key_id: state.virtualKeyId,
    principal_user_id: state.principalUserId,
    end_user_id: state.endUserId,
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

/** What an outcome handler needs from the process context. */
interface OutcomeContext<Intent> {
  projectId: string;
  intents: {
    writeDebits: (key: string, payload: WriteGatewayDebitsPayload) => Intent;
  };
}

/**
 * One outcome, routed by what the instance knows. A request that moved
 * nothing is dropped before any intent exists. Before any admission the
 * outcome is stashed for the admitted handler to release; after one it
 * freezes its debit intent, whether or not the request named an end user.
 */
function onOutcome<Intent>(
  state: GatewayDebitsState,
  ctx: OutcomeContext<Intent>,
  outcome: SpendOutcome,
): { state: GatewayDebitsState; intents?: Intent[] } {
  if (movedNothing(outcome)) return { state };
  const payload = writeDebitsPayload(state, ctx.projectId, outcome);
  if (!state.admitted) return { state: { ...state, pendingOutcome: payload } };
  return {
    state,
    intents: [ctx.intents.writeDebits(`debits:${outcome.status}`, payload)],
  };
}

/**
 * One instance per gateway request: `admitted` stores the attribution the
 * ingest seam resolved, and the outcome event freezes one deterministic
 * `writeDebits` intent. An outcome that outruns its admission waits in
 * state until admission releases it, so log order never costs a debit.
 *
 * `settled` debits nothing on purpose. Settlement means the confirmation
 * never arrived, so the cost is unknown, and unknown is not zero; a late
 * confirmation supersedes the settled row and debits then.
 */
export function gatewayDebitsPM(
  deps: GatewayDebitsProcessDeps,
): ProcessManagerApplier<GatewaySpendProcessingEvent> {
  return (pm) =>
    pm
      .state<GatewayDebitsState>(INITIAL_STATE)
      .intent(
        "writeDebits",
        writeGatewayDebitsSchema,
        runWriteGatewayDebits(deps),
      )
      // Admission carries the attribution every debit needs, so it also
      // releases an outcome that arrived ahead of it. One admission per
      // instance keeps `debits:late` minted at most once.
      .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data, ctx) => {
        const admitted = data as AdmitSpendCommandData;
        const stashed = state.pendingOutcome;
        const next = {
          ...state,
          endUserId: admitted.end_user_id ?? "",
          virtualKeyId: admitted.virtual_key_id,
          organizationId: admitted.organization_id,
          teamId: admitted.team_id ?? "",
          principalUserId: admitted.principal_user_id ?? "",
          admitted: true,
          pendingOutcome: null,
        };
        if (!stashed) return { state: next };
        return {
          state: next,
          intents: [
            ctx.intents.writeDebits("debits:late", {
              ...stashed,
              organization_id: next.organizationId,
              team_id: next.teamId,
              virtual_key_id: next.virtualKeyId,
              principal_user_id: next.principalUserId,
              end_user_id: next.endUserId,
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
