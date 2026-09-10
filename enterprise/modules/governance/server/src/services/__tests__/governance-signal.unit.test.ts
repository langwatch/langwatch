import { describe, expect, it } from "vitest";
import type { GovernanceDiagnosticsSink } from "../../app/governance.members.ts";
import type {
  GovernanceSignalChannel,
  GovernanceResolvedBudgetCrossing,
} from "../../app/governance.members.ts";
import type { GatewayBudgetCrossingCandidate } from "../../app/governance.members.ts";
import type {
  GovernanceBudgetCrossingData,
  GovernanceVkLifecycleData,
} from "../../app/governance.members.ts";
import { GovernanceSignalService } from "../governance-signal.service.ts";
import { type Instant, Temporal } from "@langwatch/time";

class RecordingDiagnostics implements GovernanceDiagnosticsSink {
  readonly warnings: Array<{
    message: string;
    context: Record<string, unknown>;
  }> = [];

  warn(message: string, context: Record<string, unknown>): void {
    this.warnings.push({ message, context });
  }
}

class RecordingSignalChannel implements GovernanceSignalChannel {
  readonly lifecycle: GovernanceVkLifecycleData[] = [];
  readonly crossings: GovernanceBudgetCrossingData[] = [];
  enabled = true;
  tenantId: string | null = "project-1";
  resolved: GovernanceResolvedBudgetCrossing[] = [];
  failure: Error | null = null;

  available(): boolean {
    return this.enabled;
  }

  now(): Instant {
    return Temporal.Instant.from("2026-08-24T12:00:00.000Z");
  }

  tryResolveLifecycleTenant(): Promise<string | null> {
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
    const channel = new RecordingSignalChannel();
    await GovernanceSignalService.create(channel).emitVirtualKeyLifecycle({
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

    expect(channel.lifecycle).toEqual([
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
    const channel = new RecordingSignalChannel();
    channel.resolved = [resolved("79"), resolved("80"), resolved("100")];
    await GovernanceSignalService.create(channel).detectBudgetCrossings([candidate]);

    expect(channel.crossings.map(({ kind }) => kind)).toEqual(["threshold_crossed", "breached"]);
    expect(channel.crossings[1]).toMatchObject({
      virtual_key_id: "key-1",
      bucket_scope_id: "key-1:user-1",
      limit_usd: "100.000000",
      spent_usd: "100.000000",
      period_started_at_ms: Date.parse("2026-08-01T00:00:00.000Z"),
    });
  });

  it("keeps signal failures advisory", async () => {
    const channel = new RecordingSignalChannel();
    const diagnostics = new RecordingDiagnostics();
    channel.failure = new Error("store unavailable");

    await expect(
      GovernanceSignalService.create(channel, diagnostics).detectBudgetCrossings([candidate]),
    ).resolves.toBeUndefined();
    expect(diagnostics.warnings).toEqual([
      expect.objectContaining({
        message: "budget crossing detection failed (best effort)",
      }),
    ]);
  });
});
