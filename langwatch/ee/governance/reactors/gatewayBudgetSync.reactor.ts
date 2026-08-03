// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { GatewayBudgetLedgerStatus, PrismaClient } from "@prisma/client";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type {
  ReactorContext,
  ReactorDefinition,
} from "~/server/event-sourcing/reactors/reactor.types";
import type {
  BudgetDebitRow,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import type {
  ApplicableScopes,
  GatewayBudgetRepository,
} from "~/server/gateway/budget.repository";
import type { BudgetChangeEventDedupeService } from "~/server/gateway/budgetChangeEventDedupe.service";
import { budgetAppliesToProvider } from "~/server/gateway/budgetResolution.service";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const logger = createLogger(
  "langwatch:trace-processing:gateway-budget-sync-reactor",
);

/**
 * Idempotency is structural: each CH row is keyed by
 * (TenantId, BudgetId, GatewayRequestId) on a ReplacingMergeTree, so
 * replays collapse at merge time. The job-id dedup below only prevents
 * same-trace thrash while the tree is still fresh.
 */
export const GATEWAY_BUDGET_SYNC_DEBOUNCE_TTL_MS = 5 * 60_000;

const ATTR_VIRTUAL_KEY_ID = "langwatch.virtual_key_id";
const ATTR_GATEWAY_REQUEST_ID = "langwatch.gateway_request_id";

/**
 * Pure relevance guard, shared by shouldReact (pre-enqueue) and handle
 * (fail-open path): only traces the gateway produced carry both a virtual
 * key and a gateway request id, and only those can debit a budget. The
 * budget resolution itself is stateful and stays in handle.
 */
function isGatewayTrace(foldState: TraceSummaryData): boolean {
  const attributes = foldState.attributes ?? {};
  return Boolean(
    attributes[ATTR_VIRTUAL_KEY_ID] && attributes[ATTR_GATEWAY_REQUEST_ID],
  );
}

export interface GatewayBudgetSyncReactorDeps {
  prisma: PrismaClient;
  budgetRepository: GatewayBudgetRepository;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  /**
   * Gates redundant BUDGET_UPDATED emissions. Optional: without it every
   * fold emits, which is what this reactor did before the dedupe existed.
   */
  changeEventDedupe?: BudgetChangeEventDedupeService;
}

/** The VK a gateway trace debits against, as this reactor needs it. */
interface GatewayVirtualKey {
  id: string;
  organizationId: string;
  principalUserId: string | null;
  lastUsedAt: Date | null;
}

/** The tenant project a gateway trace belongs to, with its owning org. */
interface GatewayFoldProject {
  id: string;
  teamId: string;
  organizationId: string;
}

/**
 * Loads the VK the trace names, or null when it does not exist — a gateway
 * trace referencing a VK we cannot find is a fold we must not attribute.
 */
async function findGatewayVirtualKey({
  prisma,
  projectId,
  virtualKeyId,
  gatewayRequestId,
}: {
  prisma: PrismaClient;
  projectId: string;
  virtualKeyId: string;
  gatewayRequestId: string;
}): Promise<GatewayVirtualKey | null> {
  const vk = await prisma.virtualKey.findUnique({
    where: { id: virtualKeyId },
    select: {
      id: true,
      organizationId: true,
      principalUserId: true,
      lastUsedAt: true,
    },
  });
  if (!vk) {
    logger.warn(
      { projectId, virtualKeyId, gatewayRequestId },
      "gateway trace references unknown VK — skipping fold",
    );
  }
  return vk;
}

/**
 * EC6 — touch lastUsedAt on every gateway trace, regardless of whether the
 * VK has applicable budgets. The /budget/check hook in gateway-internal.ts
 * only fires when the gateway calls it (which it skips when there are no
 * budgets to precheck), so VKs without budgets had `lastUsedAt = null`
 * forever and admin oversight ("when did this user last use their personal
 * VK") was broken on the most common case.
 *
 * 60s throttle mirrors the /budget/check fix — admin dashboards refresh on
 * minute-scale, no need to thrash the row on every request.
 *
 * Best-effort: a row update failure here must not poison the budget fold,
 * and the /budget/check hook is a fallback for the budgeted-VK case.
 */
async function touchVirtualKeyLastUsed({
  prisma,
  projectId,
  vk,
}: {
  prisma: PrismaClient;
  projectId: string;
  vk: GatewayVirtualKey;
}): Promise<void> {
  const now = new Date();
  const shouldTouch =
    !vk.lastUsedAt || now.getTime() - vk.lastUsedAt.getTime() > 60 * 1000;
  logger.info(
    {
      projectId,
      virtualKeyId: vk.id,
      previousLastUsedAt: vk.lastUsedAt,
      shouldTouch,
    },
    "EC6 lastUsedAt touch decision",
  );
  if (!shouldTouch) return;

  try {
    // Post-collapse VirtualKey is org-scoped in SCOPED_MODELS; the dbMTP
    // guard accepts a row id as tenancy proof for single-row writes, so the
    // bare id-only where clause is valid.
    await prisma.virtualKey.update({
      where: { id: vk.id },
      data: { lastUsedAt: now },
    });
    logger.info(
      { projectId, virtualKeyId: vk.id, touchedAt: now.toISOString() },
      "EC6 lastUsedAt touched",
    );
  } catch (touchErr) {
    logger.warn(
      { projectId, virtualKeyId: vk.id, error: touchErr },
      "failed to touch virtualKey.lastUsedAt during gateway trace fold",
    );
  }
}

/**
 * Loads the trace's tenant project, or null when the fold must not proceed.
 *
 * Cross-tenant guard: post-collapse VKs carry organizationId only, so the
 * trace's tenant project must live under the same org as the VK it debits.
 */
async function findProjectForGatewayFold({
  prisma,
  projectId,
  vk,
  gatewayRequestId,
}: {
  prisma: PrismaClient;
  projectId: string;
  vk: GatewayVirtualKey;
  gatewayRequestId: string;
}): Promise<GatewayFoldProject | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teamId: true,
      team: { select: { organizationId: true } },
    },
  });
  if (!project?.team) {
    logger.warn(
      { projectId, virtualKeyId: vk.id },
      "project missing team relation — skipping gateway budget fold",
    );
    return null;
  }
  if (project.team.organizationId !== vk.organizationId) {
    logger.warn(
      { projectId, virtualKeyId: vk.id, gatewayRequestId },
      "gateway trace references cross-tenant VK — skipping fold",
    );
    return null;
  }
  return {
    id: project.id,
    teamId: project.teamId,
    organizationId: project.team.organizationId,
  };
}

/**
 * The budgets this dispatch actually accrues against.
 *
 * `dispatchedProviderKey` is the provider the gateway dispatched to, absent
 * on gateways that predate the field — in which case only unfiltered budgets
 * accrue. Attributing an unknown dispatch to a provider-filtered budget would
 * be a guess, and a guess here silently mis-bills a governance control.
 */
async function resolveApplicableBudgets({
  budgetRepository,
  scopes,
  dispatchedProviderKey,
}: {
  budgetRepository: GatewayBudgetRepository;
  scopes: ApplicableScopes;
  dispatchedProviderKey: string | null;
}) {
  const resolved = await budgetRepository.resolveForRequest(scopes);
  return resolved.filter((r) =>
    budgetAppliesToProvider(r.budget, dispatchedProviderKey),
  );
}

/**
 * One debit row per applicable budget. Cost, tokens and duration come from
 * the fold state (post cost-enrichment) rather than being recomputed here.
 */
function buildDebitRows({
  projectId,
  foldState,
  vk,
  gatewayRequestId,
  dispatchedProviderKey,
  budgets,
  amountUsd,
}: {
  projectId: string;
  foldState: TraceSummaryData;
  vk: GatewayVirtualKey;
  gatewayRequestId: string;
  dispatchedProviderKey: string | null;
  budgets: Awaited<ReturnType<typeof resolveApplicableBudgets>>;
  amountUsd: string;
}): BudgetDebitRow[] {
  const status: GatewayBudgetLedgerStatus = foldState.blockedByGuardrail
    ? "BLOCKED_BY_GUARDRAIL"
    : foldState.containsErrorStatus
      ? "PROVIDER_ERROR"
      : "SUCCESS";

  return budgets.map(({ budget: b, bucketScopeId }) => ({
    tenantId: projectId,
    budgetId: b.id,
    scope: b.scopeType,
    scopeId: bucketScopeId,
    window: b.window,
    virtualKeyId: vk.id,
    providerKey: dispatchedProviderKey,
    gatewayRequestId,
    amountUsd,
    tokensInput: foldState.totalPromptTokenCount ?? 0,
    tokensOutput: foldState.totalCompletionTokenCount ?? 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: foldState.models[0] ?? "unknown",
    durationMs: Math.round(foldState.totalDurationMs ?? 0),
    status,
    occurredAt: new Date(foldState.occurredAt),
  }));
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
function affectsEnforcementDecision(
  budgets: Awaited<ReturnType<typeof resolveApplicableBudgets>>,
): boolean {
  return budgets.some(({ budget }) => budget.onBreach === "BLOCK");
}

/**
 * EC4 — emit a BUDGET_UPDATED change event so the gateway's /changes
 * subscriber (services/aigateway/adapters/authresolver) evicts cached
 * bundles for this project and the next request re-resolves with fresh
 * spend. Without this, Bundle.Config.Budget.SpentMicroUSD stays frozen at
 * populateConfig time and the on-breach=block precheck never fires until
 * the JWT TTL rolls.
 *
 * Every gateway request used to emit one of these, and each emission evicts
 * every bundle in the project — an L1 sweep plus a cold miss for every other
 * virtual key in it. The emissions are redundant with each other because the
 * event carries no spend figure: it asks for an eviction, and the
 * re-materialise it provokes reads current spend for every budget. One
 * eviction per window achieves what N did.
 *
 * The dedupe is skipped entirely when any applicable budget blocks on breach,
 * so an emission that could change an enforcement decision is never held
 * back. This is why the window cannot become the dominant term in
 * block-decision propagation: it is not on that path at all.
 *
 * Known limit, deliberate: this is a leading-edge window with no trailing
 * flush. If advisory traffic stops mid-window, the last debit's refresh waits
 * for the next debit or the bundle TTL. That is acceptable for a signal
 * nothing enforces on, and it cannot happen on the blocking path.
 *
 * Best-effort: the CH ledger row already landed, so a failure here leaves
 * the gateway's cache staler than it could be rather than corrupting state.
 */
async function emitBudgetUpdatedChangeEvent({
  prisma,
  changeEventDedupe,
  project,
  projectId,
  vk,
  gatewayRequestId,
  budgets,
  amountUsd,
}: {
  prisma: PrismaClient;
  changeEventDedupe?: BudgetChangeEventDedupeService;
  project: GatewayFoldProject;
  projectId: string;
  vk: GatewayVirtualKey;
  gatewayRequestId: string;
  budgets: Awaited<ReturnType<typeof resolveApplicableBudgets>>;
  amountUsd: string;
}): Promise<void> {
  try {
    if (changeEventDedupe && !affectsEnforcementDecision(budgets)) {
      const emit = await changeEventDedupe.shouldEmit({ projectId });
      if (!emit) return;
    }

    const changeEvents = new ChangeEventRepository(prisma);
    await changeEvents.append({
      organizationId: project.organizationId,
      projectId,
      kind: "BUDGET_UPDATED",
      payload: {
        gatewayRequestId,
        virtualKeyId: vk.id,
        budgetIds: budgets.map((r) => r.budget.id),
        amountUsd,
      },
    });
  } catch (changeErr) {
    logger.warn(
      { projectId, virtualKeyId: vk.id, gatewayRequestId, error: changeErr },
      "failed to emit BUDGET_UPDATED change event after fold",
    );
  }
}

/**
 * The fold itself: resolve who the trace belongs to, which budgets it
 * accrues against, write the debit rows, and tell the gateway its cached
 * spend is stale. Every step that can legitimately decline the trace
 * returns early; anything unexpected throws to the caller's catch.
 */
async function foldGatewayTraceIntoLedger({
  deps,
  projectId,
  foldState,
  virtualKeyId,
  gatewayRequestId,
}: {
  deps: GatewayBudgetSyncReactorDeps;
  projectId: string;
  foldState: TraceSummaryData;
  virtualKeyId: string;
  gatewayRequestId: string;
}): Promise<void> {
  const vk = await findGatewayVirtualKey({
    prisma: deps.prisma,
    projectId,
    virtualKeyId,
    gatewayRequestId,
  });
  if (!vk) return;

  await touchVirtualKeyLastUsed({ prisma: deps.prisma, projectId, vk });

  const project = await findProjectForGatewayFold({
    prisma: deps.prisma,
    projectId,
    vk,
    gatewayRequestId,
  });
  if (!project) return;

  const scopes: ApplicableScopes = {
    organizationId: project.organizationId,
    teamId: project.teamId,
    projectId: project.id,
    virtualKeyId: vk.id,
    principalUserId: vk.principalUserId,
  };
  const dispatchedProviderKey =
    foldState.attributes["langwatch.model_provider_id"] ?? null;

  const budgets = await resolveApplicableBudgets({
    budgetRepository: deps.budgetRepository,
    scopes,
    dispatchedProviderKey,
  });
  if (budgets.length === 0) return;

  const amountUsd = formatDecimal(foldState.totalCost ?? 0);
  await deps.budgetCHRepository.insertDebit(
    buildDebitRows({
      projectId,
      foldState,
      vk,
      gatewayRequestId,
      dispatchedProviderKey,
      budgets,
      amountUsd,
    }),
  );

  await emitBudgetUpdatedChangeEvent({
    prisma: deps.prisma,
    changeEventDedupe: deps.changeEventDedupe,
    project,
    projectId,
    vk,
    gatewayRequestId,
    budgets,
    amountUsd,
  });
}

/**
 * Fold completed gateway traces into per-budget ClickHouse debit rows.
 *
 * Registered on the trace_processing pipeline after the traceSummary fold.
 * Reads `langwatch.virtual_key_id` + `langwatch.gateway_request_id` off
 * the fold state attributes — stamped by the gateway's customer trace
 * bridge (services/aigateway/adapters/customertracebridge/emitter.go).
 * Traces without those attributes are not gateway traffic and are
 * declined before a job is enqueued.
 *
 * Cost + tokens are taken from the fold state (post cost-enrichment
 * service) so this reactor trusts the authoritative platform-side
 * numbers rather than recomputing.
 *
 * See: specs/ai-gateway/_shared/contract.md §4.5
 */
export function createGatewayBudgetSyncReactor(
  deps: GatewayBudgetSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "gatewayBudgetSync",
    // Pre-enqueue (ADR-026). The attribute check is pure and reads the exact
    // payload the handler receives, so deciding here is equivalent to the
    // early-return below — except a non-gateway trace never pays a serialize
    // + queue round-trip for a job that would immediately no-op. Every trace
    // in a project fans this reactor out; gateway traffic is a slice of it.
    // Kept in `handle` too: the queue is not the only caller (inline mode), a
    // fail-open `shouldReact` may dispatch anyway, and a job queued before
    // this gate existed still reaches the handler.
    shouldReact: (_event, context) => isGatewayTrace(context.foldState),
    options: {
      // Dedup per (tenant, trace) — one gateway trace = one debit burst.
      // Structural idempotency in the CH ReplacingMergeTree
      // (TenantId, BudgetId, GatewayRequestId) ORDER BY still protects us
      // if this TTL is shorter than the replay window.
      makeJobId: (payload) =>
        `gateway-budget-sync-${payload.event.tenantId}-${payload.event.aggregateId}`,
      ttl: GATEWAY_BUDGET_SYNC_DEBOUNCE_TTL_MS,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId: projectId, foldState } = context;

      if (!isGatewayTrace(foldState)) {
        return;
      }

      const virtualKeyId = foldState.attributes[ATTR_VIRTUAL_KEY_ID]!;
      const gatewayRequestId = foldState.attributes[ATTR_GATEWAY_REQUEST_ID]!;

      try {
        await foldGatewayTraceIntoLedger({
          deps,
          projectId,
          foldState,
          virtualKeyId,
          gatewayRequestId,
        });
      } catch (error) {
        logger.error(
          {
            projectId,
            virtualKeyId,
            gatewayRequestId,
            error,
          },
          "failed to fold gateway trace into CH budget ledger",
        );
        captureException(toError(error));
      }
    },
  };
}

/**
 * Serialise a JS number to the fixed-point decimal string CH expects
 * for Decimal(18, 10). Must round at 10 dp to avoid precision overflow.
 */
function formatDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toFixed(10);
}
