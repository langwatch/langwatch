// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The model breakdown: pulled spend grouped by the model the provider billed.
 *
 * The tests here are about faithfulness to the bill rather than arithmetic.
 * The model string is repeated exactly as it arrived — a provider that charges
 * per token kind sends a line item and that is what its invoice says — the
 * ranked order is by spend and not by name, and a model holding an unpriced
 * cell states no figure at all, same as every other total on this screen.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   Rule: Pulled spend says which model it was spent on
 * Decision: ADR-128 §1 (the model is a wave 1 "where" dimension).
 */
import { describe, expect, it, vi } from "vitest";
import { NullProjectRepository } from "~/server/app-layer/projects/repositories/project.repository";

import { GovernanceCostService } from "../governanceCost.service";
import type { GovernanceCostRollupClickHouseRepository } from "../governanceCostRollup.clickhouse.repository";
import { GovernanceCostRollupClickHouseRepository as RollupRepo } from "../governanceCostRollup.clickhouse.repository";

const NANO = 1_000_000_000;

/** A prisma double answering only the governance-project lookup. */
function prismaWith(govProjectId: string | null) {
  return {
    project: {
      findFirst: vi
        .fn()
        .mockResolvedValue(govProjectId ? { id: govProjectId } : null),
    },
  } as unknown as Parameters<typeof GovernanceCostService.create>[0]["prisma"];
}

type ModelRow = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumWindowByModel"]>
>[number];

function rollupReturning(rows: ModelRow[]) {
  return {
    sumWindowByModel: vi.fn().mockResolvedValue(rows),
  } as unknown as GovernanceCostRollupClickHouseRepository;
}

/** One model group, priced and complete unless said otherwise. */
function modelRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    model: "claude-opus-5",
    amountNanoUsd: 1 * NANO,
    cellsWithoutAmount: 0,
    ...overrides,
  };
}

function serviceOver(rows: ModelRow[]) {
  return GovernanceCostService.create({
    prisma: prismaWith("gov-1"),
    costRollup: rollupReturning(rows),
    ocsfEvents: undefined,
    gatewaySpend: undefined,
    projects: new NullProjectRepository(),
  });
}

function readModels(rows: ModelRow[]) {
  return serviceOver(rows).spendByModel({
    organizationId: "org-1",
    windowDays: 30,
  });
}

describe("GovernanceCostService.spendByModel", () => {
  describe("given pulled cost recorded under two different models", () => {
    /** @scenario Pulled spend is grouped by the model the provider named */
    it("totals each model's rows under their own model and nobody else's", async () => {
      const result = await readModels([
        modelRow({ model: "claude-opus-5", amountNanoUsd: 3 * NANO }),
        modelRow({ model: "gpt-5.2-2025-12-11", amountNanoUsd: 5 * NANO }),
      ]);

      expect(result.unavailableReason).toBeNull();
      expect(result.rows).toHaveLength(2);
      expect(
        result.rows.find((r) => r.model === "claude-opus-5")?.amountUsd,
      ).toBe(3);
      expect(
        result.rows.find((r) => r.model === "gpt-5.2-2025-12-11")?.amountUsd,
      ).toBe(5);
    });

    it("ranks them by spend, largest first, not by name", async () => {
      // The panel is a ranked list and the question it answers is which model
      // costs the most. Alphabetical order would answer a question nobody
      // asked while looking exactly like an answer to this one.
      const result = await readModels([
        modelRow({ model: "aaa-cheap", amountNanoUsd: 1 * NANO }),
        modelRow({ model: "zzz-expensive", amountNanoUsd: 9 * NANO }),
      ]);

      expect(result.rows.map((r) => r.model)).toEqual([
        "zzz-expensive",
        "aaa-cheap",
      ]);
    });
  });

  describe("given pulled cost recorded under a line item naming a model and a token kind", () => {
    /** @scenario A model billed per token kind keeps the line item the provider sent */
    it("names the row with the line item exactly as it was billed", async () => {
      // OpenAI's admin bill names a line item rather than a bare model, and
      // the puller stores it unsplit on purpose. Re-cutting it here would
      // invent a grouping the bill does not make and merge two figures a
      // reader may need apart.
      const billed = "gpt-5-mini-2025-08-07, output";
      const result = await readModels([modelRow({ model: billed })]);

      expect(result.rows.map((r) => r.model)).toEqual([billed]);
    });
  });

  describe("given a model whose rows include a cell with no amount", () => {
    /** @scenario A model holding an unpriced cell states no figure */
    it("states no figure and reports how many of its cells hold no amount", async () => {
      const result = await readModels([
        modelRow({
          model: "claude-opus-5",
          amountNanoUsd: 4 * NANO,
          cellsWithoutAmount: 2,
        }),
      ]);

      const row = result.rows.find((r) => r.model === "claude-opus-5");
      expect(row?.amountUsd).toBeNull();
      expect(row?.cellsWithoutAmount).toBe(2);
    });

    it("sorts the withheld figure last, never among the small ones", async () => {
      // A withheld figure is an unknown, not a small number. Sorted by value
      // it would land wherever a null happens to compare, and a reader
      // scanning a ranked list would read its position as a measurement.
      const result = await readModels([
        modelRow({ model: "priced-small", amountNanoUsd: 1 * NANO }),
        modelRow({
          model: "unpriced",
          amountNanoUsd: null,
          cellsWithoutAmount: 1,
        }),
        modelRow({ model: "priced-large", amountNanoUsd: 8 * NANO }),
      ]);

      expect(result.rows.map((r) => r.model)).toEqual([
        "priced-large",
        "priced-small",
        "unpriced",
      ]);
    });
  });

  describe("given no governance project for the organization", () => {
    it("says why rather than answering an empty window", async () => {
      const service = GovernanceCostService.create({
        prisma: prismaWith(null),
        costRollup: rollupReturning([]),
        ocsfEvents: undefined,
        gatewaySpend: undefined,
        projects: new NullProjectRepository(),
      });

      const result = await service.spendByModel({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.unavailableReason).toBe("no_governance_project");
      expect(result.rows).toEqual([]);
    });
  });
});

describe("GovernanceCostRollupClickHouseRepository.sumWindowByModel", () => {
  function repositoryOver(rows: unknown[]) {
    const client = {
      query: vi.fn().mockResolvedValue({ json: async () => rows }),
    };
    return {
      client,
      repo: new RollupRepo(async () => client as never),
    };
  }

  async function readQuery() {
    const { client, repo } = repositoryOver([]);
    await repo.sumWindowByModel({
      tenantId: "proj_governance_home",
      fromDay: "2026-10-01",
      toDay: "2026-10-30",
    });
    return client.query.mock.calls[0]?.[0] as {
      query: string;
      query_params: Record<string, unknown>;
    };
  }

  describe("when reading the model window", () => {
    /** @scenario Gateway rows never enter the model breakdown */
    it("counts only the pulled lane, never gateway rows", async () => {
      // The rollup holds both lanes, and the gateway lane writes a different
      // provider vocabulary into the same table. An unfiltered read would sum
      // the lanes — the one thing this screen exists to refuse.
      const call = await readQuery();

      expect(call.query).toContain("CostSource = {costsource:String}");
      expect(call.query_params.costsource).toBe("pulled");
    });

    it("groups on the model column and nothing else", async () => {
      const call = await readQuery();

      expect(call.query).toContain("GROUP BY Model");
    });

    it("dedups on the replacement version inside the group, on the current schema stamp", async () => {
      const call = await readQuery();

      expect(call.query).toContain("argMax");
      expect(call.query).toContain("Version = {version:String}");
      // sumOrNull, never sum: a group whose every cell is unpriced holds
      // nothing, and 0 would be a claim.
      expect(call.query).toContain("sumOrNull");
    });

    it("counts an unpriced cell by the strict USD rule its row can state", async () => {
      // The looser any-currency rule belongs to reads that carry a currency
      // line beside the figure. A model row is a name and a number, so
      // narrowing the count here would turn a correctly withheld figure into
      // one silently short of the non-USD spend behind it.
      const call = await readQuery();

      expect(call.query).toContain("countIf(LatestAmountNanoUsd IS NULL)");
      expect(call.query).not.toContain("CurrencyCode = {usd:String}");
    });
  });
});
