// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Layer 3 (ADR-082) for the `gatewayBudgetDebits` map projection: given the
 * debit facts derived from a gateway span, decide *which budgets it may move*
 * and shape the ledger rows that move them.
 *
 * **Why this is not the store.** ADR-082's layer-3 membership test is "does it
 * *decide* anything — retry, cache, coalesce, fan out, validate, authorise?".
 * Everything here does: it authorises the write against the VK's organization
 * AND against the projects that VK's spans can legally land in (see
 * {@link isLegalSpanDestination}, which is the only bound available on
 * customer-writable debit attributes),
 * fans one request out across every applicable budget scope, and resolves the
 * scope tuple those budgets are matched on. The store that used to hold this
 * needed four "and"s to describe. What is left there — insert, then notify —
 * needs none, which is the whole point of the split.
 *
 * The projection's `map` is pure, so every read a debit needs happens here,
 * which is also where a failure is recoverable: the map job retries, and a
 * debit that survives neither the job nor its retries is re-derived by replay
 * because the derivation lives on the replay path.
 *
 * **Nothing here swallows I/O.** A Postgres failure propagates so the map job
 * retries. Only conditions that are genuinely "nothing to debit" — a span from
 * a deleted key, a key from another org, a key no budget covers — resolve to
 * null, and those are decisions, not errors.
 */

import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { GatewayBudgetDebitRecord } from "@ee/governance/projections/gatewayBudgetDebits.mapProjection";
import { PROJECT_KIND } from "@ee/governance/services/governanceProject.service";
import type { BudgetDebitRow } from "~/server/gateway/budget.clickhouse.repository";
import {
  budgetAppliesToProvider,
  type ResolvedBudget,
} from "~/server/gateway/budgetResolution.service";
import type {
  ApplicableScopes,
  GatewayBudgetRepository,
} from "~/server/gateway/budget.repository";

const logger = createLogger("langwatch:governance:gateway-budget-debit-service");

export interface GatewayBudgetDebitServiceDeps {
  prisma: PrismaClient;
  budgetRepository: GatewayBudgetRepository;
}

/**
 * One gateway request's authorised ledger write: the rows to insert, plus the
 * identity the `BUDGET_UPDATED` change event is addressed with if they land.
 */
export interface ResolvedGatewayBudgetDebit {
  organizationId: string;
  projectId: string;
  virtualKeyId: string;
  gatewayRequestId: string;
  amountUsd: string;
  budgetIds: string[];
  rows: BudgetDebitRow[];
}

/** Shape of the VK read; narrow on purpose, so a batch read can satisfy it. */
interface VirtualKeyIdentity {
  id: string;
  organizationId: string;
  principalUserId: string | null;
  /** PROJECT-scope ids — half of this key's legal span destinations. */
  scopes: { scopeId: string }[];
}

/** Columns every VK read needs, shared so `resolve`/`resolveMany` cannot drift. */
const VIRTUAL_KEY_IDENTITY_SELECT = {
  id: true,
  organizationId: true,
  principalUserId: true,
  scopes: {
    where: { scopeType: "PROJECT" },
    select: { scopeId: true },
  },
} as const satisfies Prisma.VirtualKeySelect;

/** Shape of the project read: the org/team half of the budget scope tuple. */
interface ProjectScope {
  id: string;
  teamId: string;
  organizationId: string;
  /** `PROJECT_KIND.INTERNAL_GOVERNANCE` marks the org's hidden inbox. */
  kind: string;
}

export class GatewayBudgetDebitService {
  constructor(private readonly deps: GatewayBudgetDebitServiceDeps) {}

  /**
   * Resolve one gateway request's debit, or null when there is nothing to
   * charge.
   */
  async resolve(
    record: GatewayBudgetDebitRecord,
  ): Promise<ResolvedGatewayBudgetDebit | null> {
    const projectId = record.tenantId;

    const vk = await this.deps.prisma.virtualKey.findUnique({
      where: { id: record.virtualKeyId },
      select: VIRTUAL_KEY_IDENTITY_SELECT,
    });
    if (!vk) {
      this.warnUnknownVirtualKey(record);
      return null;
    }

    const project = await this.readProjectScope(projectId);
    if (!project) {
      this.warnMissingProjectTeam(record);
      return null;
    }

    return await this.authoriseAndShape({ record, vk, project });
  }

  /**
   * Batch form of {@link resolve} for the replay path.
   *
   * Rebuilding a window re-derives one record per gateway span. Resolving
   * each one on its own costs two Postgres reads plus a budget query PER
   * SPAN, over a set of records that — because a bulk write is tenant-scoped
   * — share one project, and between them name only a handful of distinct
   * virtual keys. So the project read collapses to one per tenant, the key
   * reads to one `findMany`, and the budget query to one per distinct
   * (key, principal) tuple rather than one per request.
   *
   * The decisions are identical to running {@link resolve} in a loop, with
   * one addition the sequential path got for free: duplicate deliveries of
   * the same `gatewayRequestId` inside a single batch collapse to the first,
   * because the ledger's replay guard is one probe per request id and a
   * batch is written under a single probe.
   */
  async resolveMany(
    records: readonly GatewayBudgetDebitRecord[],
  ): Promise<ResolvedGatewayBudgetDebit[]> {
    if (records.length === 0) return [];

    const resolved: ResolvedGatewayBudgetDebit[] = [];
    for (const [projectId, forTenant] of groupBy(records, (r) => r.tenantId)) {
      resolved.push(...(await this.resolveForOneTenant(projectId, forTenant)));
    }
    return resolved;
  }

  private async resolveForOneTenant(
    projectId: string,
    records: readonly GatewayBudgetDebitRecord[],
  ): Promise<ResolvedGatewayBudgetDebit[]> {
    // First delivery of a request id wins, exactly as the ledger probe makes
    // it win on the sequential path.
    const deduped = new Map<string, GatewayBudgetDebitRecord>();
    for (const record of records) {
      if (!deduped.has(record.gatewayRequestId)) {
        deduped.set(record.gatewayRequestId, record);
      }
    }

    const project = await this.readProjectScope(projectId);
    if (!project) {
      for (const record of deduped.values()) this.warnMissingProjectTeam(record);
      return [];
    }

    const keys = await this.deps.prisma.virtualKey.findMany({
      where: { id: { in: [...new Set([...deduped.values()].map((r) => r.virtualKeyId))] } },
      select: VIRTUAL_KEY_IDENTITY_SELECT,
    });
    const keysById = new Map(keys.map((key) => [key.id, key]));

    // One budget query per distinct key rather than per request: the scope
    // tuple only varies by (virtualKeyId, principalUserId) once the project
    // is fixed, and `resolveForRequest` is a pure function of it. The
    // provider filter is NOT cached with it — it varies per request.
    const budgetsByKey = new Map<string, ResolvedBudget[]>();

    const resolved: ResolvedGatewayBudgetDebit[] = [];
    for (const record of deduped.values()) {
      const vk = keysById.get(record.virtualKeyId);
      if (!vk) {
        this.warnUnknownVirtualKey(record);
        continue;
      }
      const debit = await this.authoriseAndShape({
        record,
        vk,
        project,
        budgetCache: budgetsByKey,
      });
      if (debit) resolved.push(debit);
    }
    return resolved;
  }

  /**
   * The authorisation decision and the row fan-out — the half both entry
   * points share, so neither can drift into charging what the other refuses.
   */
  private async authoriseAndShape({
    record,
    vk,
    project,
    budgetCache,
  }: {
    record: GatewayBudgetDebitRecord;
    vk: VirtualKeyIdentity;
    project: ProjectScope;
    budgetCache?: Map<string, ResolvedBudget[]>;
  }): Promise<ResolvedGatewayBudgetDebit | null> {
    // Cross-tenant guard: post-collapse VKs carry organizationId only, so the
    // trace's tenant project must live under the same org before its spend is
    // allowed to move that org's budgets.
    if (project.organizationId !== vk.organizationId) {
      logger.warn(
        {
          projectId: project.id,
          virtualKeyId: record.virtualKeyId,
          gatewayRequestId: record.gatewayRequestId,
        },
        "gateway span references cross-tenant VK — refusing to debit",
      );
      return null;
    }

    if (!isLegalSpanDestination({ vk, project })) {
      logger.warn(
        {
          projectId: project.id,
          virtualKeyId: record.virtualKeyId,
          gatewayRequestId: record.gatewayRequestId,
        },
        "gateway span landed in a project this VK never exports to — refusing to debit",
      );
      return null;
    }

    const scopes: ApplicableScopes = {
      organizationId: project.organizationId,
      teamId: project.teamId,
      projectId: project.id,
      virtualKeyId: vk.id,
      principalUserId: vk.principalUserId,
    };

    let resolvedBudgets = budgetCache?.get(vk.id);
    if (!resolvedBudgets) {
      resolvedBudgets = await this.deps.budgetRepository.resolveForRequest(
        scopes,
      );
      budgetCache?.set(vk.id, resolvedBudgets);
    }

    // Which budgets this spend counts against depends on the provider the
    // gateway dispatched to, which varies per request — so the filter sits
    // here, outside the per-key resolution cache above.
    const budgets = resolvedBudgets.filter((r) =>
      budgetAppliesToProvider(r.budget, record.providerKey),
    );
    if (budgets.length === 0) return null;

    const rows: BudgetDebitRow[] = budgets.map(({ budget, bucketScopeId }) => ({
      tenantId: project.id,
      budgetId: budget.id,
      scope: budget.scopeType,
      // The enforcement bucket, not the budget's target: a provider-filtered
      // budget and a per-member GROUP allowance each accrue under their own
      // key, so they cannot report each other's spend.
      scopeId: bucketScopeId,
      window: budget.window,
      virtualKeyId: vk.id,
      providerKey: record.providerKey,
      gatewayRequestId: record.gatewayRequestId,
      amountUsd: record.amountUsd,
      tokensInput: record.tokensInput,
      tokensOutput: record.tokensOutput,
      // Carried over from the reactor as literal zeros. The per-span cache
      // counts ARE available (`SpanCostService.extractCacheTokens`), but
      // populating columns the ledger has always written as 0 would move
      // numbers on the usage page as a side effect of a durability change.
      // Filling them is a separate, deliberate change — it does not touch
      // AmountUSD and so cannot move a budget.
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: record.model,
      durationMs: record.durationMs,
      status: record.status,
      occurredAt: record.occurredAt,
    }));

    return {
      organizationId: project.organizationId,
      projectId: project.id,
      virtualKeyId: vk.id,
      gatewayRequestId: record.gatewayRequestId,
      amountUsd: record.amountUsd,
      budgetIds: budgets.map((r) => r.budget.id),
      rows,
    };
  }

  private async readProjectScope(
    projectId: string,
  ): Promise<ProjectScope | null> {
    const project = await this.deps.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        teamId: true,
        kind: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project?.team) return null;
    return {
      id: project.id,
      teamId: project.teamId,
      organizationId: project.team.organizationId,
      kind: project.kind,
    };
  }

  private warnUnknownVirtualKey(record: GatewayBudgetDebitRecord): void {
    logger.warn(
      {
        projectId: record.tenantId,
        virtualKeyId: record.virtualKeyId,
        gatewayRequestId: record.gatewayRequestId,
      },
      "gateway span references unknown VK — no budget to debit",
    );
  }

  private warnMissingProjectTeam(record: GatewayBudgetDebitRecord): void {
    logger.warn(
      { projectId: record.tenantId, virtualKeyId: record.virtualKeyId },
      "project missing team relation — no budget scope to resolve",
    );
  }
}

/**
 * Does this span's tenant project belong to the set the gateway could ever
 * have exported this VK's spans to?
 *
 * **What this is standing in for.** Every attribute the debit is derived from
 * — `langwatch.virtual_key_id`, `langwatch.gateway_request_id`, the
 * `gen_ai.usage.*` counts behind `amountUsd` — is written by the gateway into
 * an ordinary OTLP span, and that span reaches the platform through the
 * PUBLIC `/api/otel/v1/traces` route authenticated with the trace project's
 * own API key (`customertracebridge`'s registry exports with
 * `X-Auth-Token: project_otlp_token`, and `config.materialiser.ts` sets that
 * token to `traceProject.apiKey`). The gateway also has no usage-report
 * channel of its own: `controlplane.Client` only ever calls resolve-key /
 * changes / config / guardrail / health. So there is NO receiver-stamped
 * marker distinguishing a gateway span from one a customer wrote by hand, and
 * none can exist without a protocol change. Gating on any span attribute
 * would be gating on something the forger also controls.
 *
 * **What is enforceable instead.** Where the span LANDED is not the payload's
 * to choose — it is the project whose API key authenticated the request.
 * `resolveTraceProject` (scopeResolver.ts) can only ever route a VK's spans to
 * one of its PROJECT scopes or to the org's hidden `internal_governance`
 * project, so a span for this VK arriving anywhere else was not exported by
 * the bridge. Rejecting those narrows forgery from "any project key in the
 * organization can burn the whole org's gateway budget" to "a key for one of
 * the VK's own trace destinations can" — and a holder of that key can already
 * spend against those budgets legitimately.
 *
 * **Still open.** A key for the VK's own trace project (or for the org's
 * governance project, which every ORG/TEAM-scoped VK routes to) can still
 * fabricate debits for that VK. Closing it needs a receiver-stamped gateway
 * origin: either a dedicated gateway-only ingest credential whose spans the
 * receiver marks, or moving usage onto the HMAC-signed control-plane channel.
 * Both change the wire contract, so neither belongs in this change.
 *
 * The test is a SUPERSET of `resolveTraceProject`'s answer on purpose: a VK
 * that has been re-scoped since a span was written must still have that span's
 * debit re-derivable on replay, and matching the live resolution exactly would
 * silently drop historical spend on rebuild.
 */
function isLegalSpanDestination({
  vk,
  project,
}: {
  vk: VirtualKeyIdentity;
  project: ProjectScope;
}): boolean {
  if (project.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) return true;
  return vk.scopes.some((scope) => scope.scopeId === project.id);
}

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const bucket = grouped.get(key(item));
    if (bucket) bucket.push(item);
    else grouped.set(key(item), [item]);
  }
  return grouped;
}
