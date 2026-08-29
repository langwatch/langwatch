import { describe, expect, it, vi } from "vitest";
import {
  GovernanceSetupActivityPort,
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../governance-setup-state.port";
import { DefaultGovernanceSetupStateService } from "../../services/governance-setup-state.service";

const emptyCounts = (): GovernanceSetupCounts => ({
  personalVirtualKeys: 0,
  routingPolicies: 0,
  ingestionSources: 0,
  anomalyRules: 0,
  applicationProjectsWithTraces: 0,
  governanceTenantId: null,
});

class FixedSetupRepository extends GovernanceSetupStateRepository {
  constructor(private readonly value: GovernanceSetupCounts) {
    super();
  }

  async counts(): Promise<GovernanceSetupCounts> {
    return this.value;
  }
}

class RecordingActivityPort extends GovernanceSetupActivityPort {
  readonly hasRecentActivity = vi.fn().mockResolvedValue(false);
}

describe("DefaultGovernanceSetupStateService", () => {
  it("returns inactive when no governance state exists", async () => {
    const state = await DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository(emptyCounts()),
    }).resolve("organization");

    expect(state).toEqual({
      hasPersonalVKs: false,
      hasRoutingPolicies: false,
      hasIngestionSources: false,
      hasAnomalyRules: false,
      hasRecentActivity: false,
      hasApplicationTraces: false,
      governanceActive: false,
    });
  });

  it("activates governance for any persisted governance feature", async () => {
    const state = await DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository({
        ...emptyCounts(),
        ingestionSources: 1,
      }),
    }).resolve("organization");

    expect(state.hasIngestionSources).toBe(true);
    expect(state.governanceActive).toBe(true);
  });

  it("probes recent activity only when a governance tenant exists", async () => {
    const activity = new RecordingActivityPort();
    activity.hasRecentActivity.mockResolvedValue(true);
    const service = DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository({
        ...emptyCounts(),
        governanceTenantId: "governance-project",
      }),
      activity,
      now: () => 40 * 24 * 60 * 60 * 1_000,
    });

    const state = await service.resolve("organization");

    expect(activity.hasRecentActivity).toHaveBeenCalledWith({
      tenantId: "governance-project",
      sinceMs: 10 * 24 * 60 * 60 * 1_000,
    });
    expect(state.hasRecentActivity).toBe(true);
    expect(state.governanceActive).toBe(true);
  });

  it("reports application traces without treating them as governance state", async () => {
    const state = await DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository({
        ...emptyCounts(),
        applicationProjectsWithTraces: 1,
      }),
    }).resolve("organization");

    expect(state.hasApplicationTraces).toBe(true);
    expect(state.governanceActive).toBe(false);
  });
});
