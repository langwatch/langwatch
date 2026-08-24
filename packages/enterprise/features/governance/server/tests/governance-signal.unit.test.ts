import { describe, expect, it } from "vitest";
import { GovernanceDiagnosticsPort } from "../src/ports/governance-diagnostics.port";
import {
  GovernanceSignalPort,
  type GovernanceResolvedBudgetCrossing,
} from "../src/ports/governance-signal.port";
import type { GatewayBudgetCrossingCandidate } from "../src/ports/gateway-debit.port";
import type {
  GovernanceBudgetCrossingData,
  GovernanceVkLifecycleData,
} from "../src/ports/governance-webhook.port";
import { GovernanceSignalService } from "../src/services/governance-signal.service";

class RecordingDiagnostics extends GovernanceDiagnosticsPort {
  readonly warnings: Array<{
    message: string;
    context: Record<string, unknown>;
  }> = [];

  warn(message: string, context: Record<string, unknown>): void {
    this.warnings.push({ message, context });
  }
}

class RecordingSignalPort extends GovernanceSignalPort {
  readonly lifecycle: GovernanceVkLifecycleData[] = [];
  readonly crossings: GovernanceBudgetCrossingData[] = [];
  enabled = true;
  tenantId: string | null = "project-1";
  resolved: GovernanceResolvedBudgetCrossing[] = [];
  failure: Error | null = null;

  available(): boolean {
    return this.enabled;
  }

  now(): Date {
    return new Date("2026-08-24T12:00:00.000Z");
  }

  resolveLifecycleTenant(): Promise<string | null> {
    return Promise.resolve(this.tenantId);
  }

  resolveBudgetCrossings(): Promise<GovernanceResolvedBudgetCrossing[]> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.resolved);
  }

  appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void> {
    this.lifecycle.push(data);
    return Promise.resolve();
  }

  appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void> {
    this.crossings.push(data);
    return Promise.resolve();
  }
}

const candidate: GatewayBudgetCrossingCandidate = {
  tenantId: "project-1",
  budgetId: "budget-1",
  bucketScopeId: "key-1:user-1",
  endUserId: "user-1",
};

function resolved(spentUsd: string): GovernanceResolvedBudgetCrossing {
  return {
    candidate,
    budget: {
      id: "budget-1",
      organizationId: "org-1",
      scopeType: "ATTRIBUTED_USER",
      scopeId: "key-1",
      window: "MONTH",
      limitUsd: "100",
      onBreach: "BLOCK",
    },
    spentUsd,
    periodStartedAtMs: Date.parse("2026-08-01T00:00:00.000Z"),
  };
}

describe("GovernanceSignalService", () => {
  it("creates a lifecycle fact with resolved tenancy and one clock", async () => {
    const port = new RecordingSignalPort();
    await GovernanceSignalService.create(port).emitVirtualKeyLifecycle({
      virtualKey: {
        id: "key-1",
        organizationId: "org-1",
        name: "production",
        displayPrefix: "vk-lw-123",
        traceProjectId: null,
      },
      action: "disabled",
      reason: "operator hold",
    });

    expect(port.lifecycle).toEqual([
      expect.objectContaining({
        tenantId: "project-1",
        virtual_key_id: "key-1",
        action: "disabled",
        reason: "operator hold",
        occurred_at: Date.parse("2026-08-24T12:00:00.000Z"),
      }),
    ]);
  });

  it("emits only threshold and breach crossings", async () => {
    const port = new RecordingSignalPort();
    port.resolved = [resolved("79"), resolved("80"), resolved("100")];
    await GovernanceSignalService.create(port).detectBudgetCrossings([
      candidate,
    ]);

    expect(port.crossings.map(({ kind }) => kind)).toEqual([
      "threshold_crossed",
      "breached",
    ]);
    expect(port.crossings[1]).toMatchObject({
      virtual_key_id: "key-1",
      bucket_scope_id: "key-1:user-1",
      limit_usd: "100.000000",
      spent_usd: "100.000000",
      period_started_at_ms: Date.parse("2026-08-01T00:00:00.000Z"),
    });
  });

  it("keeps signal failures advisory", async () => {
    const port = new RecordingSignalPort();
    const diagnostics = new RecordingDiagnostics();
    port.failure = new Error("store unavailable");

    await expect(
      GovernanceSignalService.create(
        port,
        diagnostics,
      ).detectBudgetCrossings([candidate]),
    ).resolves.toBeUndefined();
    expect(diagnostics.warnings).toEqual([
      expect.objectContaining({
        message: "budget crossing detection failed (best effort)",
      }),
    ]);
  });
});
