import type { FoldProjectionStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type {
  AppendGatewayAuditInput,
  GatewayAuditRepository,
} from "../gateway-audit.repository.ts";
import { GatewayBudgetChangeDedupeRepository } from "../gateway-budget-change-dedupe.repository.ts";
import type { GatewaySpendFoldCacheRepository } from "../gateway-spend-fold-cache.repository.ts";
import type {
  GatewayPersistenceTransaction,
  GatewayTransactionRepository,
} from "../gateway-transaction.repository.ts";
import type { GatewayRepositories } from "../gateway.repositories.ts";
import { MemoryGatewayAgentCacheEntryRepository } from "./memory.gateway-agent-cache.repository.ts";
import { MemoryGatewayBudgetSpendRepository } from "./memory.gateway-budget-spend.repository.ts";
import { MemoryGatewayBudgetRepository } from "./memory.gateway-budget.repository.ts";
import { MemoryGatewayCacheRuleRepository } from "./memory.gateway-cache-rule.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "./memory.gateway-change-event.repository.ts";
import { MemoryGatewayConnectUpstreamRepository } from "./memory.gateway-connect-upstream.repository.ts";
import { MemoryGatewayGuardrailRepository } from "./memory.gateway-guardrail.repository.ts";
import { MemoryGatewayInternalStoreRepository } from "./memory.gateway-internal-store.repository.ts";
import { MemoryGatewayKeyBudgetRepository } from "./memory.gateway-key-budget.repository.ts";
import { MemoryGatewayOpenAdmissionsRepository } from "./memory.gateway-open-admissions.repository.ts";
import { MemoryGatewayOrganizationDirectoryRepository } from "./memory.gateway-organization-directory.repository.ts";
import { MemoryGatewayPrincipalSpendRepository } from "./memory.gateway-principal-spend.repository.ts";
import { MemoryGatewayProviderLabelRepository } from "./memory.gateway-provider-label.repository.ts";
import { MemoryGatewayRealtimeSessionRepository } from "./memory.gateway-realtime-session.repository.ts";
import { MemoryGatewayScopeResolutionRepository } from "./memory.gateway-scope-resolution.repository.ts";
import { MemoryGatewaySpendEventsRepository } from "./memory.gateway-spend-events.repository.ts";
import { MemoryGatewaySpendScopeRepository } from "./memory.gateway-spend-scope.repository.ts";
import { MemoryGatewayTraceDestinationReportRepository } from "./memory.gateway-trace-destination-report.repository.ts";
import { MemoryGatewayTraceExportKeyRepository } from "./memory.gateway-trace-export-key.repository.ts";
import { MemoryVirtualKeyDirectBudgetRepository } from "./memory.gateway-virtual-key-direct-budget.repository.ts";
import { MemoryGatewayVirtualKeyRepository } from "./memory.gateway-virtual-key.repository.ts";
import { MemoryGatewayStore } from "./memory.gateway.store.ts";
import { MemoryVirtualKeyAuthorizationRepository } from "./memory.virtual-key-authorization.repository.ts";

/**
 * The gateway on no store at all: every twin over one shared memory store, so
 * a key a drawer writes is the key every read answers from. A test seeds the
 * rows other modules own through the store it passes.
 */
export class MemoryGatewayRepositories {
  static readonly requires = [] as const;

  static create(): GatewayRepositories {
    return new MemoryGatewayRepositories(MemoryGatewayStore.create()).repositories;
  }

  /** Every twin, over the one store; a test builds this over a store it seeded. */
  readonly repositories: GatewayRepositories;

  constructor(store: MemoryGatewayStore) {
    const changeEvents = MemoryGatewayChangeEventsRepository.create();
    const audit = MemoryGatewayAuditRepository.create(store);
    const budgetSpend = MemoryGatewayBudgetSpendRepository.create();
    const spendEvents = MemoryGatewaySpendEventsRepository.create();

    this.repositories = {
      virtualKeys: MemoryGatewayVirtualKeyRepository.create(store),
      transactions: MemoryGatewayTransactionRepository.create(store),
      keyBudgets: MemoryGatewayKeyBudgetRepository.create(store),
      changeEvents,
      audit,
      scopeResolution: MemoryGatewayScopeResolutionRepository.create(store),
      virtualKeyAuthorization: MemoryVirtualKeyAuthorizationRepository.create(store),
      organizationDirectory: MemoryGatewayOrganizationDirectoryRepository.create(store),
      budgets: MemoryGatewayBudgetRepository.create({
        store,
        budgetSpend,
        changes: changeEvents,
        audit,
      }),
      cacheRules: MemoryGatewayCacheRuleRepository.create({ store, changes: changeEvents, audit }),
      guardrails: MemoryGatewayGuardrailRepository.create(store),
      providerLabels: MemoryGatewayProviderLabelRepository.create(store),
      directBudgets: MemoryVirtualKeyDirectBudgetRepository.create(store),
      spendScope: MemoryGatewaySpendScopeRepository.create(store),
      connectUpstream: MemoryGatewayConnectUpstreamRepository.create(),
      realtimeSessions: MemoryGatewayRealtimeSessionRepository.create(),
      internalStore: MemoryGatewayInternalStoreRepository.create(),
      traceExportKeys: MemoryGatewayTraceExportKeyRepository.create(),
      traceDestinationReport: MemoryGatewayTraceDestinationReportRepository.create(store),
      budgetSpend,
      principalSpend: MemoryGatewayPrincipalSpendRepository.create(),
      spendEvents,
      openAdmissions: MemoryGatewayOpenAdmissionsRepository.create(spendEvents),
      agentCache: MemoryGatewayAgentCacheEntryRepository.create(),
      spendFoldCache: MemoryGatewaySpendFoldCacheRepository.create(),
      budgetChangeDedupe: MemoryGatewayBudgetChangeDedupeRepository.create(),
    };
  }
}

/** The gateway's audit trail in memory: appended to the store's `auditEntries`. */
export class MemoryGatewayAuditRepository implements GatewayAuditRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayAuditRepository {
    return new MemoryGatewayAuditRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {}

  async append(input: AppendGatewayAuditInput): Promise<void> {
    this.store.auditEntries.push({ ...input, projectId: input.projectId ?? null });
  }
}

/** One claim per project per window, lapsing when the window does, as the Redis key expires. */
export class MemoryGatewayBudgetChangeDedupeRepository extends GatewayBudgetChangeDedupeRepository {
  static create(): MemoryGatewayBudgetChangeDedupeRepository {
    return new MemoryGatewayBudgetChangeDedupeRepository();
  }

  readonly #claimedUntil = new Map<string, number>();

  private constructor() {
    super();
  }

  async claimWindow(input: { projectId: string; windowSeconds: number }): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    const until = this.#claimedUntil.get(input.projectId);
    if (until !== undefined && until > now) return false;
    this.#claimedUntil.set(input.projectId, now + input.windowSeconds * 1000);

    return true;
  }
}

/** No cache tier in memory: the durable store is already as fast as a cache. */
class MemoryGatewaySpendFoldCacheRepository implements GatewaySpendFoldCacheRepository {
  static create(): MemoryGatewaySpendFoldCacheRepository {
    return new MemoryGatewaySpendFoldCacheRepository();
  }

  private constructor() {}

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}

/** One unit of work over the shared memory rows: a throw leaves them as they were. */
export class MemoryGatewayTransactionRepository implements GatewayTransactionRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayTransactionRepository {
    return new MemoryGatewayTransactionRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {}

  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T> {
    return this.store.atomically(() => work({}));
  }
}
