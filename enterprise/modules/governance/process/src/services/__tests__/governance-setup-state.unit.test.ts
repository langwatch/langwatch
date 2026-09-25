import { createApiFixture } from "@langwatch/api-fixture";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InternalProject, ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { gatewayKey } from "../../__tests__/support/gateway-virtual-key.fixture.ts";
import type { GovernanceSetupActivityReader } from "../../app/governance.members.ts";
import {
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../../repositories/governance-setup-state.repository.ts";
import { DefaultGovernanceSetupStateService } from "../governance-setup-state.service.ts";

const emptyCounts = (): GovernanceSetupCounts => ({
  routingPolicies: 0,
  ingestionSources: 0,
  anomalyRules: 0,
  applicationProjectsWithTraces: 0,
});

const governanceProject: InternalProject = {
  id: "governance-project",
  name: "Governance",
  slug: "governance",
  teamId: "team",
  kind: "internal_governance",
  archivedAtMs: null,
  traceSharingEnabled: false,
};

const peers = ({ keys = 0, tenant = false }: { keys?: number; tenant?: boolean } = {}) => ({
  keys: createApiFixture<GatewayApi>({
    findPersonalVirtualKeys: async () => Array.from({ length: keys }, () => gatewayKey()),
  }),
  projects: createApiFixture<ProjectApi>({
    findInternal: async () => (tenant ? governanceProject : null),
  }),
});

class FixedSetupRepository extends GovernanceSetupStateRepository {
  constructor(private readonly value: GovernanceSetupCounts) {
    super();
  }

  async counts(): Promise<GovernanceSetupCounts> {
    return this.value;
  }
}

class RecordingActivity implements GovernanceSetupActivityReader {
  readonly hasRecentActivity = vi.fn().mockResolvedValue(false);
}

describe("DefaultGovernanceSetupStateService", () => {
  it("returns inactive when no governance state exists", async () => {
    const state = await DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository(emptyCounts()),
      ...peers(),
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
      ...peers(),
    }).resolve("organization");

    expect(state.hasIngestionSources).toBe(true);
    expect(state.governanceActive).toBe(true);
  });

  it("probes recent activity only when a governance tenant exists", async () => {
    const activity = new RecordingActivity();
    activity.hasRecentActivity.mockResolvedValue(true);
    const service = DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository(emptyCounts()),
      ...peers({ tenant: true }),
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
      ...peers(),
    }).resolve("organization");

    expect(state.hasApplicationTraces).toBe(true);
    expect(state.governanceActive).toBe(false);
  });

  it("activates governance when a person holds a live personal key", async () => {
    const state = await DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository(emptyCounts()),
      ...peers({ keys: 1 }),
    }).resolve("organization");

    expect(state.hasPersonalVKs).toBe(true);
    expect(state.governanceActive).toBe(true);
  });
});
