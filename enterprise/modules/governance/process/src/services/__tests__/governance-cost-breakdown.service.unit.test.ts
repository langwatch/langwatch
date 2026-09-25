// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's cost breakdown reads over the memory twins. @see specs/governance/governance-cost-screen.feature */
import { createApiFixture } from "@langwatch/api-fixture";
import type { InternalProject, ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";
import { MemoryDiscoveredPersonRepository } from "../../repositories/memory/memory.discovered-person.repository.ts";
import {
  type MemoryGovernanceCostCell,
  MemoryGovernanceCostRollupRepository,
} from "../../repositories/memory/memory.governance-cost-rollup.repository.ts";
import { GovernanceCostBreakdownService } from "../governance-cost-breakdown.service.ts";

const NOW = Temporal.Instant.from("2026-09-25T12:00:00Z");
const TENANT = "governance-project";
const GOVERNANCE_PROJECT: InternalProject = {
  id: TENANT,
  name: "Governance",
  slug: "governance",
  teamId: "team",
  kind: "internal_governance",
  archivedAtMs: null,
  traceSharingEnabled: false,
};

function cell(overrides: Partial<MemoryGovernanceCostCell>): MemoryGovernanceCostCell {
  return {
    tenantId: TENANT,
    day: "2026-09-20",
    costSource: "pulled",
    ingestionSourceId: "src_1",
    provider: "openai",
    model: "gpt-5",
    agentId: "",
    currencyCode: "USD",
    rawActorId: "",
    amountNanoUsd: 1_000_000_000,
    amountNanoMinor: 1_000_000_000,
    ...overrides,
  };
}

function setup({ governed = true }: { governed?: boolean } = {}) {
  const costRollup = MemoryGovernanceCostRollupRepository.create();
  const discoveredPeople = MemoryDiscoveredPersonRepository.create(
    MemoryDiscoveredPeopleStore.create(),
  );
  const projects = createApiFixture<ProjectApi>({
    findInternal: async () => (governed ? GOVERNANCE_PROJECT : null),
  });
  const service = GovernanceCostBreakdownService.create({ costRollup, projects, discoveredPeople });
  const window = { organizationId: "org_1", windowDays: 30, now: NOW };
  return { costRollup, discoveredPeople, service, window };
}

describe("GovernanceCostBreakdownService", () => {
  describe("given an organization that never ingested anything", () => {
    it("answers every breakdown unavailable rather than empty-and-zero", async () => {
      const { service, window } = setup({ governed: false });

      await expect(service.spendByModel(window)).resolves.toEqual({
        unavailableReason: "no_governance_project",
        rows: [],
        windowDays: 30,
      });
    });
  });

  describe("when the spender breakdown is read", () => {
    /** @scenario "Gateway rows never enter the spender breakdown" */
    it("counts pulled rows only", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ rawActorId: "u-1" }));
      costRollup.seed(
        cell({ rawActorId: "u-1", costSource: "gateway", amountNanoUsd: 9_000_000_000 }),
      );

      const { rows } = await service.spenderBreakdown(window);

      expect(rows.map((row) => row.amountUsd)).toEqual([1]);
    });

    /** @scenario "The same spender id at two providers stays two spenders" */
    it("keeps one id at two providers apart", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ rawActorId: "u-1", provider: "openai" }));
      costRollup.seed(cell({ rawActorId: "u-1", provider: "anthropic" }));

      const { rows } = await service.spenderBreakdown(window);

      expect(rows.map((row) => row.provider).toSorted()).toEqual(["anthropic", "openai"]);
    });

    /** @scenario "A spender discovery has seen is labeled with the identity screen's display text" */
    it("labels a discovered spender with its display text", async () => {
      const { costRollup, discoveredPeople, service, window } = setup();
      costRollup.seed(cell({ rawActorId: "u-1" }));
      await discoveredPeople.recordActivitySighting({
        organizationId: "org_1",
        provider: "openai",
        rawActorId: "u-1",
        displayText: "ada@example.com",
        kind: "user",
        earliestAt: NOW,
        latestAt: NOW,
      });

      const { rows } = await service.spenderBreakdown(window);

      expect(rows[0]?.label).toBe("ada@example.com");
    });

    /** @scenario "A spender mixing priced and unpriced rows holds no figure" */
    it("withholds the figure of a spender with an unpriced cell", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ rawActorId: "u-1", model: "gpt-5" }));
      costRollup.seed(cell({ rawActorId: "u-1", model: "o3", amountNanoUsd: null }));

      const { rows } = await service.spenderBreakdown(window);

      expect(rows[0]).toMatchObject({ amountUsd: null, cellsWithoutAmount: 1 });
    });

    /** @scenario "Breakdown rows are spender-and-agent pairings" */
    it("splits a spender per agent and leaves an agentless row's agent empty", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ rawActorId: "u-1", agentId: "space-a" }));
      costRollup.seed(
        cell({ rawActorId: "u-1", agentId: "space-b", amountNanoUsd: 2_000_000_000 }),
      );
      costRollup.seed(cell({ rawActorId: "u-2" }));

      const { rows } = await service.spenderBreakdown(window);

      expect(rows.map((row) => [row.rawActorId, row.agentId, row.amountUsd])).toEqual([
        ["u-1", "space-b", 2],
        ["u-1", "space-a", 1],
        ["u-2", "", 1],
      ]);
    });
  });
});
