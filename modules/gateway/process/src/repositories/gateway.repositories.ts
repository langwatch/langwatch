import type { GatewayAgentCacheEntryRepository } from "./gateway-agent-cache.repository.ts";
import type { GatewayAuditRepository } from "./gateway-audit.repository.ts";
import type { GatewayBudgetChangeDedupeRepository } from "./gateway-budget-change-dedupe.repository.ts";
import type { GatewayBudgetSpendRepository } from "./gateway-budget-spend.repository.ts";
import type { GatewayBudgetRepository } from "./gateway-budget.repository.ts";
import type { GatewayCacheRuleRepository } from "./gateway-cache-rule.repository.ts";
import type { GatewayChangeEventsRepository } from "./gateway-change-event.repository.ts";
import type { GatewayConnectUpstreamRepository } from "./gateway-connect-upstream.repository.ts";
import type { GatewayGuardrailRepository } from "./gateway-guardrail.repository.ts";
import type { GatewayInternalStoreRepository } from "./gateway-internal-store.repository.ts";
import type { GatewayKeyBudgetRepository } from "./gateway-key-budget.repository.ts";
import type { GatewayOpenAdmissionsRepository } from "./gateway-open-admissions.repository.ts";
import type { GatewayOrganizationDirectoryRepository } from "./gateway-organization-directory.repository.ts";
import type { GatewayPrincipalSpendRepository } from "./gateway-principal-spend.repository.ts";
import type { GatewayProviderLabelRepository } from "./gateway-provider-label.repository.ts";
import type { GatewayRealtimeSessionRepository } from "./gateway-realtime-session.repository.ts";
import type { GatewayScopeResolutionRepository } from "./gateway-scope-resolution.repository.ts";
import type { GatewaySpendEventsRepository } from "./gateway-spend-events.repository.ts";
import type { GatewaySpendFoldCacheRepository } from "./gateway-spend-fold-cache.repository.ts";
import type { GatewaySpendScopeRepository } from "./gateway-spend-scope.repository.ts";
import type { GatewayTraceExportKeyRepository } from "./gateway-trace-export-key.repository.ts";
import type { GatewayTransactionRepository } from "./gateway-transaction.repository.ts";
import type { VirtualKeyDirectBudgetRepository } from "./gateway-virtual-key-direct-budget.repository.ts";
import type { GatewayVirtualKeyRepository } from "./gateway-virtual-key.repository.ts";
import type { VirtualKeyAuthorizationRepository } from "./virtual-key-authorization.repository.ts";

/** The process's cipher: the live tier seals tokens at rest; memory twins hold plaintext. */
export type GatewayCipher = Readonly<{
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}>;

/**
 * The state the gateway owns, chosen once at boot. One tier spans three
 * coexisting stores: Postgres holds keys, budgets and rules, ClickHouse the
 * spend ledger, Redis the agent cache and the fold's warm state.
 */
export interface GatewayRepositories {
  readonly virtualKeys: GatewayVirtualKeyRepository;
  /** Runs a key write and its budget rows as one unit. */
  readonly transactions: GatewayTransactionRepository;
  readonly keyBudgets: GatewayKeyBudgetRepository;
  /** The change feed the Go data plane long-polls. */
  readonly changeEvents: GatewayChangeEventsRepository;
  readonly audit: GatewayAuditRepository;
  readonly scopeResolution: GatewayScopeResolutionRepository;
  readonly virtualKeyAuthorization: VirtualKeyAuthorizationRepository;
  readonly organizationDirectory: GatewayOrganizationDirectoryRepository;
  readonly budgets: GatewayBudgetRepository;
  readonly cacheRules: GatewayCacheRuleRepository;
  readonly guardrails: GatewayGuardrailRepository;
  readonly providerLabels: GatewayProviderLabelRepository;
  readonly directBudgets: VirtualKeyDirectBudgetRepository;
  /** The key ids behind the external ids a spend filter names. */
  readonly spendScope: GatewaySpendScopeRepository;
  readonly connectUpstream: GatewayConnectUpstreamRepository;
  readonly realtimeSessions: GatewayRealtimeSessionRepository;
  readonly internalStore: GatewayInternalStoreRepository;
  readonly traceExportKeys: GatewayTraceExportKeyRepository;
  /** The budget ledger every debit lands in and every health figure reads. */
  readonly budgetSpend: GatewayBudgetSpendRepository;
  readonly principalSpend: GatewayPrincipalSpendRepository;
  /** The spend-event ledger gateway_spend folds into. */
  readonly spendEvents: GatewaySpendEventsRepository;
  /** The settlement sweep's read of every server's open admissions. */
  readonly openAdmissions: GatewayOpenAdmissionsRepository;
  readonly agentCache: GatewayAgentCacheEntryRepository;
  /** gateway_spend's warm fold state. */
  readonly spendFoldCache: GatewaySpendFoldCacheRepository;
  /** The advisory window that keeps a busy project from a BUDGET_UPDATED per debit. */
  readonly budgetChangeDedupe: GatewayBudgetChangeDedupeRepository;
}
