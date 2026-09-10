import { SoftWarnPercent } from "@langwatch/enterprise-governance-contract";
import type { GatewayBudgetCrossingCandidate } from "../app/governance.members.ts";
import type { GovernanceBudgetCrossingData } from "../app/governance.members.ts";
import type { GovernanceDiagnosticsSink } from "../app/governance.members.ts";
import { NullGovernanceDiagnosticsAdapter } from "./governance-diagnostics.service.ts";
import {
  GovernanceSignalChannel,
  type GovernanceResolvedBudgetCrossing,
  type GovernanceVirtualKeyLifecycleSignal,
} from "../app/governance.members.ts";
import { type Instant } from "@langwatch/time";

export class GovernanceSignalService {
  private constructor(
    private readonly port: GovernanceSignalChannel,
    private readonly diagnostics: GovernanceDiagnosticsSink,
  ) {}

  static create(
    port: GovernanceSignalChannel,
    diagnostics: GovernanceDiagnosticsSink = new NullGovernanceDiagnosticsAdapter(),
  ): GovernanceSignalService {
    return new GovernanceSignalService(port, diagnostics);
  }

  async emitVirtualKeyLifecycle(signal: GovernanceVirtualKeyLifecycleSignal): Promise<void> {
    if (!this.port.available()) {
      return;
    }

    try {
      const tenantId = await this.port.tryResolveLifecycleTenant({
        organizationId: signal.virtualKey.organizationId,
        preferredProjectId: signal.virtualKey.traceProjectId,
      });
      if (!tenantId) {
        return;
      }

      await this.port.appendVirtualKeyLifecycle({
        tenantId,
        organization_id: signal.virtualKey.organizationId,
        virtual_key_id: signal.virtualKey.id,
        action: signal.action,
        name: signal.virtualKey.name,
        display_prefix: signal.virtualKey.displayPrefix,
        reason: signal.reason ?? null,
        occurred_at: this.port.now().epochMilliseconds,
      });
    } catch (error) {
      this.diagnostics.warn("failed to append vk lifecycle governance event (best effort)", {
        virtualKeyId: signal.virtualKey.id,
        action: signal.action,
        error,
      });
    }
  }

  async detectBudgetCrossings(candidates: GatewayBudgetCrossingCandidate[]): Promise<void> {
    if (candidates.length === 0 || !this.port.available()) {
      return;
    }

    try {
      const now = this.port.now();
      const resolved = await this.port.resolveBudgetCrossings(candidates, now);
      for (const crossing of resolved) {
        const data = this.tryCrossingData(crossing, now);
        if (data) {
          await this.port.appendBudgetCrossing(data);
        }
      }
    } catch (error) {
      this.diagnostics.warn("budget crossing detection failed (best effort)", {
        budgets: candidates.length,
        error,
      });
    }
  }

  private tryCrossingData(
    resolved: GovernanceResolvedBudgetCrossing,
    now: Instant,
  ): GovernanceBudgetCrossingData | null {
    const spent = Number.parseFloat(resolved.spentUsd) || 0;
    const limit = Number.parseFloat(resolved.budget.limitUsd) || 0;
    if (limit <= 0) {
      return null;
    }

    const percentage = (spent * 100) / limit;
    let kind: GovernanceBudgetCrossingData["kind"] | null = null;
    if (percentage >= 100) {
      kind = "breached";
    } else if (percentage >= SoftWarnPercent) {
      kind = "threshold_crossed";
    }

    if (!kind) {
      return null;
    }

    const { budget, candidate } = resolved;

    return {
      tenantId: candidate.tenantId,
      organization_id: budget.organizationId,
      budget_id: budget.id,
      kind,
      scope_type: budget.scopeType.toLowerCase(),
      bucket_scope_id: candidate.bucketScopeId,
      end_user_id: candidate.endUserId,
      virtual_key_id:
        budget.scopeType === "VIRTUAL_KEY" || budget.scopeType === "ATTRIBUTED_USER"
          ? budget.scopeId
          : null,
      anchor_project_id: budget.scopeType === "PROJECT" ? budget.scopeId : null,
      window: budget.window,
      period_started_at_ms: resolved.periodStartedAtMs,
      limit_usd: limit.toFixed(6),
      spent_usd: spent.toFixed(6),
      on_breach: budget.onBreach === "BLOCK" ? "block" : "warn",
      occurred_at: now.epochMilliseconds,
    };
  }
}
