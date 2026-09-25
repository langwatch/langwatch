// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's model and period-record reads over the memory twins. @see specs/governance/governance-cost-screen.feature */
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
  describe("when the model breakdown is read", () => {
    /** @scenario "Pulled spend is grouped by the model the provider named" */
    it("totals each model the provider named, largest first", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ model: "gpt-5", rawActorId: "u-1" }));
      costRollup.seed(cell({ model: "gpt-5", rawActorId: "u-2" }));
      costRollup.seed(cell({ model: "o3", amountNanoUsd: 500_000_000 }));

      const { rows } = await service.spendByModel(window);

      expect(rows.map((row) => [row.model, row.amountUsd])).toEqual([
        ["gpt-5", 2],
        ["o3", 0.5],
      ]);
    });

    /** @scenario "Gateway rows never enter the model breakdown" */
    it("leaves gateway rows out", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ model: "gpt-5", costSource: "gateway" }));

      await expect(service.spendByModel(window)).resolves.toMatchObject({ rows: [] });
    });

    /** @scenario "A model holding an unpriced cell states no figure" */
    it("withholds a model's figure and ranks it below every stated one", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ model: "a-model", amountNanoUsd: null, rawActorId: "u-1" }));
      costRollup.seed(cell({ model: "a-model", rawActorId: "u-2" }));
      costRollup.seed(cell({ model: "z-model", amountNanoUsd: 1 }));

      const { rows } = await service.spendByModel(window);

      expect(rows.map((row) => [row.model, row.amountUsd, row.cellsWithoutAmount])).toEqual([
        ["z-model", 0.000000001, 0],
        ["a-model", null, 1],
      ]);
    });
  });

  describe("when the records behind a period are read", () => {
    /** @scenario "The records behind a period cover every day the period holds" */
    it("counts every day inside the period and none outside it", async () => {
      const { costRollup, service } = setup();
      costRollup.seed(cell({ day: "2026-07-01" }));
      costRollup.seed(cell({ day: "2026-07-31" }));
      costRollup.seed(cell({ day: "2026-08-01" }));
      const period = { organizationId: "org_1", provider: "openai" };

      const { records } = await service.periodRecords({
        ...period,
        fromDay: "2026-07-01",
        toDay: "2026-07-31",
      });

      expect(records).toEqual([
        { label: "gpt-5", amountUsd: 2, cellsWithoutAmount: 0, currenciesWithoutUsdAmount: [] },
      ]);
    });

    it("names a record by model and agent, and one naming neither as not named", async () => {
      const { costRollup, service } = setup();
      costRollup.seed(cell({ agentId: "space-a" }));
      costRollup.seed(cell({ model: "", amountNanoUsd: 3_000_000_000 }));
      const period = { organizationId: "org_1", provider: "openai" };

      const { records } = await service.periodRecords({
        ...period,
        fromDay: "2026-09-01",
        toDay: "2026-09-30",
      });

      expect(records.map((record) => record.label)).toEqual(["Not named", "gpt-5 (space-a)"]);
    });

    it("marks the currency a euro-only cell leaves out of the figure", async () => {
      const { costRollup, service } = setup();
      costRollup.seed(cell({ currencyCode: "EUR", amountNanoUsd: null, amountNanoMinor: 5 }));
      const period = { organizationId: "org_1", provider: "openai" };

      const { records } = await service.periodRecords({
        ...period,
        fromDay: "2026-09-01",
        toDay: "2026-09-30",
      });

      expect(records[0]).toMatchObject({
        amountUsd: null,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: ["EUR"],
      });
    });
  });

  describe("when the provider split over time is read", () => {
    it("answers one row per day and provider inside the trailing window", async () => {
      const { costRollup, service, window } = setup();
      costRollup.seed(cell({ day: "2026-08-26" }));
      costRollup.seed(cell({ day: "2026-08-27" }));
      costRollup.seed(cell({ day: "2026-09-25", provider: "anthropic" }));

      const { rows } = await service.dailyByProvider(window);

      expect(rows.map((row) => [row.day, row.provider, row.amountUsd])).toEqual([
        ["2026-08-27", "openai", 1],
        ["2026-09-25", "anthropic", 1],
      ]);
    });
  });
});
