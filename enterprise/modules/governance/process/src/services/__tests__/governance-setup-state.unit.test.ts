import { createApiFixture } from "@langwatch/api-fixture";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InternalProject, ProjectApi } from "@langwatch/project-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { gatewayKey } from "../../__tests__/support/gateway-virtual-key.fixture.ts";
import {
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../../repositories/governance-setup-state.repository.ts";
import { DefaultGovernanceSetupStateService } from "../governance-setup-state.service.ts";

const emptyCounts = (): GovernanceSetupCounts => ({
  ingestionSources: 0,
  anomalyRules: 0,
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

const peers = ({
  keys = 0,
  tenant = false,
  traced = 0,
}: { keys?: number; tenant?: boolean; traced?: number } = {}) => ({
  keys: createApiFixture<GatewayApi>({
    findPersonalVirtualKeys: async () => Array.from({ length: keys }, () => gatewayKey()),
  }),
  routingPolicies: createApiFixture<EnterpriseGatewayApi>({ countRoutingPolicies: async () => 0 }),
  projects: createApiFixture<ProjectApi>({
    findInternal: async () => (tenant ? governanceProject : null),
    countWithTraces: async () => traced,
  }),
  traces: createApiFixture<TraceApi>({ hasTraceWithAttribute: async () => false }),
});

class FixedSetupRepository extends GovernanceSetupStateRepository {
  constructor(private readonly value: GovernanceSetupCounts) {
    super();
  }

  async counts(): Promise<GovernanceSetupCounts> {
    return this.value;
  }
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
    const hasTraceWithAttribute = vi.fn().mockResolvedValue(true);
    const traces = createApiFixture<TraceApi>({ hasTraceWithAttribute });
    const service = DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository(emptyCounts()),
      ...peers({ tenant: true }),
      traces,
      now: () => 40 * 24 * 60 * 60 * 1_000,
    });

    const state = await service.resolve("organization");

    expect(hasTraceWithAttribute).toHaveBeenCalledWith({
      projectId: "governance-project",
      sinceMs: 10 * 24 * 60 * 60 * 1_000,
      attribute: { key: GOVERNANCE_ATTR.ORIGIN_KIND, value: GOVERNANCE_ORIGIN_KIND_VALUE },
    });
    expect(state.hasRecentActivity).toBe(true);
    expect(state.governanceActive).toBe(true);
  });

  it("reports application traces without treating them as governance state", async () => {
    const state = await DefaultGovernanceSetupStateService.create({
      repository: new FixedSetupRepository(emptyCounts()),
      ...peers({ traced: 1 }),
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
