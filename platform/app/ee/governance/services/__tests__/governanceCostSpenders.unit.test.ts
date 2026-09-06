// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The spender breakdown: pulled spend grouped by who spent it, labeled with
 * the words the People screen uses.
 *
 * The tests here are mostly about identity and honesty, not arithmetic: a
 * spender is (provider, id) and never the id alone; the label is the
 * discovered person's display text and never an invention; blank ids gather
 * under one bucket rather than a fake person; and a spender whose rows are
 * partly unpriced gets no figure at all, same as every lane total.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   Rule: Pulled spend says who spent it, in the words the identity screen uses
 * Decision: ADR-128 §14 / ADR-129.
 */
import { describe, expect, it, vi } from "vitest";

import { GovernanceCostService } from "../governanceCost.service";
import type { GovernanceCostRollupClickHouseRepository } from "../governanceCostRollup.clickhouse.repository";
import { GovernanceCostRollupClickHouseRepository as RollupRepo } from "../governanceCostRollup.clickhouse.repository";

const NANO = 1_000_000_000;

/** One discovered person, as the label resolution selects them. */
type PersonRow = {
  provider: string;
  rawActorId: string;
  displayText: string;
};

/**
 * A prisma double answering the governance-project lookup and the discovery
 * read the labels come from. `people` defaults to none: discovery has seen
 * nobody, so every row falls back to its raw id.
 */
function prismaWith(govProjectId: string | null, people: PersonRow[] = []) {
  return {
    project: {
      findFirst: vi
        .fn()
        .mockResolvedValue(govProjectId ? { id: govProjectId } : null),
    },
    discoveredPerson: {
      findMany: vi.fn().mockResolvedValue(people),
    },
  } as unknown as Parameters<typeof GovernanceCostService.create>[0]["prisma"];
}

type SpenderRow = Awaited<
  ReturnType<GovernanceCostRollupClickHouseRepository["sumWindowBySpender"]>
>[number];

function rollupReturning(rows: SpenderRow[]) {
  return {
    sumWindowBySpender: vi.fn().mockResolvedValue(rows),
  } as unknown as GovernanceCostRollupClickHouseRepository;
}

/** One (provider, spender, agent) group, priced and complete unless said otherwise. */
function spenderRow(overrides: Partial<SpenderRow> = {}): SpenderRow {
  return {
    provider: "openai_admin",
    rawActorId: "u_ada",
    agentId: "",
    amountNanoUsd: 1 * NANO,
    cellsWithoutAmount: 0,
    ...overrides,
  };
}

function serviceOver(rows: SpenderRow[], people: PersonRow[] = []) {
  return GovernanceCostService.create({
    prisma: prismaWith("gov-1", people),
    costRollup: rollupReturning(rows),
    ocsfEvents: undefined,
  });
}

describe("GovernanceCostService.spenderBreakdown", () => {
  describe("given pulled cost recorded under two different spender ids at one provider", () => {
    /** @scenario Pulled spend is grouped by who spent it */
    it("totals each spender's rows under their own spender and nobody else's", async () => {
      const service = serviceOver([
        spenderRow({ rawActorId: "u_ada", amountNanoUsd: 3 * NANO }),
        spenderRow({ rawActorId: "u_grace", amountNanoUsd: 5 * NANO }),
      ]);

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.unavailableReason).toBeNull();
      const ada = result.rows.find((r) => r.rawActorId === "u_ada");
      const grace = result.rows.find((r) => r.rawActorId === "u_grace");
      expect(ada?.amountUsd).toBe(3);
      expect(grace?.amountUsd).toBe(5);
      expect(result.rows).toHaveLength(2);
    });
  });

  describe("given one spender id string at two different providers", () => {
    /** @scenario The same spender id at two providers stays two spenders */
    it("keeps the two providers' rows separate, each labeled from its own provider's discovery", async () => {
      // The same string names two DIFFERENT people — (provider, id) is the
      // discovered person's unique key. Merging them hands one person the
      // other's money and one of the two the wrong name.
      const service = serviceOver(
        [
          spenderRow({ provider: "openai_admin", rawActorId: "1234" }),
          spenderRow({ provider: "databricks_genie", rawActorId: "1234" }),
        ],
        [
          { provider: "openai_admin", rawActorId: "1234", displayText: "Ada" },
          {
            provider: "databricks_genie",
            rawActorId: "1234",
            displayText: "Grace",
          },
        ],
      );

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.rows).toHaveLength(2);
      const labels = result.rows.map((r) => r.label).sort();
      expect(labels).toEqual(["Ada", "Grace"]);
    });
  });

  describe("given a spender id that discovery has seen", () => {
    /** @scenario A spender discovery has seen is labeled with the identity screen's display text */
    it("labels the row with that person's display text", async () => {
      // The display text, NOT a linked member's name: the People screen
      // labels every row with the display text, and a different word here
      // makes one person read as two.
      const service = serviceOver(
        [spenderRow({ rawActorId: "u_ada" })],
        [
          {
            provider: "openai_admin",
            rawActorId: "u_ada",
            displayText: "ada@acme.example",
          },
        ],
      );

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.rows[0]?.label).toBe("ada@acme.example");
    });

    it("labels a spender discovery has NOT seen with the raw id itself", async () => {
      const service = serviceOver([spenderRow({ rawActorId: "u_unknown" })]);

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.rows[0]?.label).toBe("u_unknown");
    });

    it("does not borrow a display text from the same id at another provider", async () => {
      const service = serviceOver(
        [spenderRow({ provider: "databricks_genie", rawActorId: "1234" })],
        [{ provider: "openai_admin", rawActorId: "1234", displayText: "Ada" }],
      );

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.rows[0]?.label).toBe("1234");
    });
  });

  describe("given pulled cost whose rows carry no spender id", () => {
    /** @scenario Spend nobody is named for gathers under one honest bucket */
    it("gathers that spend under a single not-named row and invents no name", async () => {
      // Blank ids from two providers are still ONE honest bucket — nobody
      // was named, and pretending the provider distinction names someone
      // would be an invention.
      const service = serviceOver([
        spenderRow({
          provider: "openai_admin",
          rawActorId: "",
          amountNanoUsd: 2 * NANO,
        }),
        spenderRow({
          provider: "azure_cost_management",
          rawActorId: "",
          amountNanoUsd: 3 * NANO,
        }),
        spenderRow({ rawActorId: "u_ada", amountNanoUsd: 1 * NANO }),
      ]);

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      const buckets = result.rows.filter((r) => r.rawActorId === "");
      expect(buckets).toHaveLength(1);
      expect(buckets[0]?.label).toBeNull();
      expect(buckets[0]?.amountUsd).toBe(5);
      // The bucket sorts last regardless of size: it is a remainder, not a
      // person outspending everyone.
      expect(result.rows[result.rows.length - 1]?.rawActorId).toBe("");
    });
  });

  describe("given pulled cost recorded under an erased person's pseudonym", () => {
    /** @scenario An erased spender is shown by pseudonym */
    it("labels the row with the pseudonym", async () => {
      // Erasure rewrote the discovery row's id and display text to the same
      // pseudonym, so the join matches and shows it — same mechanics as any
      // known spender, pinned because the input is an erasure product.
      const pseudonym = "a".repeat(64);
      const service = serviceOver(
        [spenderRow({ rawActorId: pseudonym })],
        [
          {
            provider: "openai_admin",
            rawActorId: pseudonym,
            displayText: pseudonym,
          },
        ],
      );

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.rows[0]?.label).toBe(pseudonym);
    });
  });

  describe("given one spender with priced rows and rows holding no US dollar figure", () => {
    /** @scenario A spender mixing priced and unpriced rows holds no figure */
    it("holds no total and says how many rows carry no figure", async () => {
      const service = serviceOver([
        spenderRow({ amountNanoUsd: 7 * NANO, cellsWithoutAmount: 2 }),
      ]);

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.rows[0]?.amountUsd).toBeNull();
      expect(result.rows[0]?.amountUsd).not.toBe(7);
      expect(result.rows[0]?.cellsWithoutAmount).toBe(2);
    });
  });

  describe("given one spender whose rows name two different agents", () => {
    /** @scenario Breakdown rows are spender-and-agent pairings */
    it("shows the spender once per agent, each pairing totaling its own rows", async () => {
      const service = serviceOver([
        spenderRow({
          provider: "databricks_genie",
          rawActorId: "grace@acme.example",
          agentId: "space-1",
          amountNanoUsd: 2 * NANO,
        }),
        spenderRow({
          provider: "databricks_genie",
          rawActorId: "grace@acme.example",
          agentId: "space-2",
          amountNanoUsd: 4 * NANO,
        }),
        spenderRow({ rawActorId: "u_ada", agentId: "" }),
      ]);

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      const grace = result.rows.filter(
        (r) => r.rawActorId === "grace@acme.example",
      );
      expect(grace).toHaveLength(2);
      expect(grace.map((r) => [r.agentId, r.amountUsd]).sort()).toEqual([
        ["space-1", 2],
        ["space-2", 4],
      ]);
      const ada = result.rows.find((r) => r.rawActorId === "u_ada");
      expect(ada?.agentId).toBe("");
    });
  });

  describe("given a deployment with no cost store", () => {
    it("reports unavailable with no rows rather than an empty panel pretending to be knowledge", async () => {
      const service = GovernanceCostService.create({
        prisma: prismaWith("gov-1"),
        costRollup: undefined,
        ocsfEvents: undefined,
      });

      const result = await service.spenderBreakdown({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(result.unavailableReason).toBe("no_cost_store");
      expect(result.rows).toEqual([]);
    });
  });
});

describe("GovernanceCostRollupClickHouseRepository.sumWindowBySpender", () => {
  function repositoryOver(rows: unknown[]) {
    const client = {
      query: vi.fn().mockResolvedValue({ json: async () => rows }),
    };
    return {
      client,
      repo: new RollupRepo(async () => client as never),
    };
  }

  describe("when reading the spender window", () => {
    /** @scenario Gateway rows never enter the spender breakdown */
    it("counts only the pulled lane, never gateway rows", async () => {
      // The rollup holds both lanes, and the gateway lane writes actor ids
      // under a different provider vocabulary. An unfiltered read would sum
      // the lanes — the one thing this screen exists to refuse.
      const { client, repo } = repositoryOver([]);
      await repo.sumWindowBySpender({
        tenantId: "proj_governance_home",
        fromDay: "2026-10-01",
        toDay: "2026-10-30",
      });

      const call = client.query.mock.calls[0]?.[0] as {
        query: string;
        query_params: Record<string, unknown>;
      };
      expect(call.query).toContain("CostSource = {costsource:String}");
      expect(call.query_params.costsource).toBe("pulled");
    });

    it("dedups on the replacement version inside the group, on the current schema stamp", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumWindowBySpender({
        tenantId: "proj_governance_home",
        fromDay: "2026-10-01",
        toDay: "2026-10-30",
      });

      const call = client.query.mock.calls[0]?.[0] as { query: string };
      expect(call.query).toContain("argMax");
      expect(call.query).toContain("Version = {version:String}");
      // sumOrNull, never sum: a group whose every cell is unpriced holds
      // nothing, and 0 would be a claim.
      expect(call.query).toContain("sumOrNull");
    });
  });
});
