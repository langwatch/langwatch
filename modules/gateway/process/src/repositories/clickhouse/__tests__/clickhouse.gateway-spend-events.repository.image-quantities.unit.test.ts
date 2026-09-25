/**
 * The image-token quantities on the summary and end-user read paths: this
 * pins that the rollup reads select and map them too, rather than silently
 * reporting every image call at a fraction of its real usage.
 */
import { describe, expect, it } from "vitest";

import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

type Query = { query: string; query_params?: Record<string, unknown> };

function repositoryOver(rows: unknown[] = []) {
  const queries: Query[] = [];
  const client = {
    query: async (q: Query) => {
      queries.push(q);

      return { json: async () => rows };
    },
  };

  return {
    queries,
    repository: ClickHouseGatewaySpendEventsRepository.create(async () => client as never),
  };
}

describe("ClickHouseGatewaySpendEventsRepository image quantities", () => {
  describe("readSpendSummaries()", () => {
    it("selects the image columns alongside the token columns", async () => {
      const { repository, queries } = repositoryOver([]);

      await repository.readSpendSummaries({
        tenantIds: ["project-1"],
        groupBy: ["model"],
        fromMs: 0,
        toMs: 1,
      });

      const sql = queries[0]!.query;
      expect(sql).toContain("TokensInputImage");
      expect(sql).toContain("TokensOutputImage");
      expect(sql).toContain("ImageCount");
    });

    it("maps the summed image columns onto the row", async () => {
      const { repository } = repositoryOver([
        {
          GroupKey0: "gpt-image-1",
          EventCount: 3,
          SettledCount: 0,
          TokensInput: 100,
          TokensOutput: 50,
          TokensCacheRead: 0,
          TokensCacheWrite: 0,
          TokensReasoning: 0,
          TokensInputImage: 1600,
          TokensOutputImage: 3200,
          ImageCount: 2,
          CostNanoUSD: 5_000_000,
        },
      ]);

      const { rows } = await repository.readSpendSummaries({
        tenantIds: ["project-1"],
        groupBy: ["model"],
        fromMs: 0,
        toMs: 1,
      });

      expect(rows[0]).toMatchObject({
        tokensInputImage: 1600,
        tokensOutputImage: 3200,
        imageCount: 2,
      });
    });

    it("defaults the image columns to 0 when a row carries none", async () => {
      const { repository } = repositoryOver([
        {
          GroupKey0: "gpt-5-mini",
          EventCount: 1,
          SettledCount: 0,
          TokensInput: 10,
          TokensOutput: 5,
          TokensCacheRead: 0,
          TokensCacheWrite: 0,
          TokensReasoning: 0,
          CostNanoUSD: 100,
        },
      ]);

      const { rows } = await repository.readSpendSummaries({
        tenantIds: ["project-1"],
        groupBy: ["model"],
        fromMs: 0,
        toMs: 1,
      });

      expect(rows[0]).toMatchObject({ tokensInputImage: 0, tokensOutputImage: 0, imageCount: 0 });
    });
  });

  describe("readEndUserSpend()", () => {
    it("selects and sums the image columns", async () => {
      const { repository, queries } = repositoryOver([
        {
          SpendNanoUSD: 8_000_000,
          RequestCount: 4,
          TokensInput: 200,
          TokensOutput: 100,
          TokensCacheRead: 0,
          TokensCacheWrite: 0,
          TokensReasoning: 0,
          TokensInputImage: 800,
          TokensOutputImage: 1600,
          ImageCount: 1,
        },
      ]);

      const result = await repository.readEndUserSpend({
        tenantIds: ["project-1"],
        endUserId: "end-user-1",
        fromMs: 0,
        toMs: 1,
      });

      expect(queries[0]!.query).toContain("TokensInputImage");
      expect(result).toMatchObject({
        tokensInputImage: 800,
        tokensOutputImage: 1600,
        imageCount: 1,
      });
    });

    it("answers zeroed image quantities without resolving a client when no tenant is named", async () => {
      const { repository, queries } = repositoryOver([]);

      const result = await repository.readEndUserSpend({
        tenantIds: [],
        endUserId: "end-user-1",
        fromMs: 0,
        toMs: 1,
      });

      expect(queries).toHaveLength(0);
      expect(result).toMatchObject({ tokensInputImage: 0, tokensOutputImage: 0, imageCount: 0 });
    });
  });
});
