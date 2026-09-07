import type {
  GovernanceBudgetCrossingData,
  GovernanceVkLifecycleData,
} from "./governance-webhook.port.ts";
import type {
  GatewayBudgetCrossingCandidate,
  GatewayBudgetScope,
  GatewayBudgetWindow,
} from "./gateway-debit.port.ts";
import type { Instant } from "@langwatch/time";

export type GovernanceVirtualKeyLifecycleSignal = {
  virtualKey: {
    id: string;
    organizationId: string;
    name: string;
    displayPrefix: string;
    traceProjectId: string | null;
  };
  action: GovernanceVkLifecycleData["action"];
  reason?: string | null;
};

export type GovernanceResolvedBudgetCrossing = {
  candidate: GatewayBudgetCrossingCandidate;
  budget: {
    id: string;
    organizationId: string;
    scopeType: GatewayBudgetScope;
    scopeId: string;
    window: GatewayBudgetWindow;
    limitUsd: string;
    onBreach: "BLOCK" | "WARN";
  };
  spentUsd: string;
  periodStartedAtMs: number;
};

export abstract class GovernanceSignalPort {
  abstract available(): boolean;
  abstract now(): Instant;
  abstract tryResolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null>;
  abstract resolveBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
    now: Instant,
  ): Promise<GovernanceResolvedBudgetCrossing[]>;
  abstract appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void>;
  abstract appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void>;
}
