// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The shape of the metered lane's ledger read, against a stubbed client.
 *
 * What a stub can see is the SQL text and the parameters: that the read is
 * fenced to the organization's tenants, that it collapses the ledger to one
 * row per request before it sums anything, that it never names a person
 * column, and that it carries a deadline under the wire limit. What a stub
 * cannot see — the arithmetic — is in the integration test beside this one.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   ("THE METERED LANE READS THE GATEWAY'S OWN LEDGER")
 */
import { describe, expect, it, vi } from "vitest";

import { GovernanceGatewaySpendClickHouseRepository } from "../governanceGatewaySpend.clickhouse.repository";

function makeClient(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ json: async () => rows }),
  };
}

function repositoryOver(rows: unknown[]) {
  const client = makeClient(rows);
  return {
    client,
    repo: new GovernanceGatewaySpendClickHouseRepository(
      async () => client as never,
    ),
  };
}

function queryOf(client: { query: ReturnType<typeof vi.fn> }): string {
  return String(client.query.mock.calls[0]?.[0]?.query ?? "");
}

function callOf(client: { query: ReturnType<typeof vi.fn> }) {
  return client.query.mock.calls[0]?.[0] as {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings?: Record<string, unknown>;
  };
}

/** The query with runs of whitespace collapsed, so an assertion reads the
 *  expression rather than the indentation it happens to carry. */
function flat(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

/**
 * The read's outer SELECT items: everything between the leading SELECT and the
 * collapse it reads FROM, split on the commas that separate items rather than
 * the ones inside a call's arguments.
 *
 * The subquery is skipped by construction — it sits inside the `FROM (...)`
 * this stops at — which is what keeps its per-request `argMax(TokensInput, ...)`
 * out of the rules below. Those are the collapse, never the total.
 */
function outerSelectItems(client: {
  query: ReturnType<typeof vi.fn>;
}): string[] {
  const query = flat(queryOf(client));
  const list = query.slice(
    query.indexOf("SELECT") + "SELECT".length,
    query.indexOf("FROM ("),
  );
  const items: string[] = [];
  let depth = 0;
  let item = "";
  for (const character of list) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      items.push(item.trim());
      item = "";
      continue;
    }
    item += character;
  }
  if (item.trim() !== "") items.push(item.trim());
  return items;
}

/**
 * The expression behind the read's token figure: the outer SELECT item whose
 * alias names a token total.
 *
 * The alias is matched loosely on purpose — what the rules below are about is
 * which ledger columns the expression adds up, not the word chosen for the
 * column. Returns "" when the read states no token figure at all, which every
 * test below asserts against first: a rule about which columns an expression
 * names proves nothing against an expression that does not exist.
 */
function meteredTokenExpression(client: {
  query: ReturnType<typeof vi.fn>;
}): string {
  return (
    outerSelectItems(client).find((item) =>
      /\bAS\s+\w*Token\w*\b/.test(item),
    ) ?? ""
  );
}

const WINDOW = {
  tenantIds: ["proj_a", "proj_b"],
  fromDay: "2026-08-01",
  toDay: "2026-08-07",
};

/** The three reads, so a rule every one of them must obey is asserted once. */
type ReadInput = typeof WINDOW;
const READS = [
  [
    "by day",
    (repo: GovernanceGatewaySpendClickHouseRepository, input: ReadInput) =>
      repo.sumDaysForOrganizationProjects(input),
  ],
  [
    "by model",
    (repo: GovernanceGatewaySpendClickHouseRepository, input: ReadInput) =>
      repo.sumWindowByModel(input),
  ],
  [
    "by virtual key",
    (repo: GovernanceGatewaySpendClickHouseRepository, input: ReadInput) =>
      repo.sumWindowByVirtualKey(input),
  ],
] as const;

describe("GovernanceGatewaySpendClickHouseRepository", () => {
  describe.each(READS)("when reading the ledger %s", (_label, read) => {
    it("fences the read to the organization's tenants, tenant first", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const call = callOf(client);
      expect(call.query).toContain("TenantId IN {tenantIds:Array(String)}");
      expect(call.query_params.tenantIds).toEqual(["proj_a", "proj_b"]);
      // The tenant predicate leads: nothing else in this table is unique
      // across tenants, and it is the first sort key.
      const where = call.query.indexOf("WHERE");
      const tenant = call.query.indexOf("TenantId IN");
      expect(where).toBeGreaterThan(-1);
      expect(tenant).toBeGreaterThan(where);
      expect(call.query.slice(where, tenant)).not.toMatch(/AND/);
    });

    it("collapses the ledger to one row per request before summing", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const query = queryOf(client);
      // FINAL is not enough: a request folded outcome-first and admitted
      // later sits in two monthly partitions with two OccurredAt values, and
      // FINAL dedups within a partition. The version column decides which
      // row is the request.
      expect(query).not.toMatch(/\bFINAL\b/);
      expect(query).toContain("GROUP BY TenantId, GatewayRequestId");
      expect(query).toContain("argMax(Status, EventTimestamp)");
      expect(query).toContain("argMax(CostNanoUSD, EventTimestamp)");
      expect(query).toContain("argMax(OccurredAt, EventTimestamp)");
    });

    it("counts confirmed and failed requests as spend, and settled ones as unknown", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const query = queryOf(client);
      // A failed request with partial usage is priced and charged.
      expect(query).toContain("IN ('confirmed', 'failed')");
      // An admission whose confirmation never arrived: cost unknown, so it is
      // counted beside the total and adds nothing to it.
      expect(query).toContain("= 'settled'");
      expect(query).toContain("AS RequestsWithoutAmount");
    });

    it("counts the priced requests apart from the charged ones", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      // A charged request priced at zero with tokens consumed is charged but
      // not priced. The service needs the priced count on its own to tell a
      // day that spent nothing from a day whose cost is unknown; the charged
      // count alone cannot, and subtracting the unpriced count would fold the
      // settled requests into it.
      expect(queryOf(client)).toContain(
        "countIf(RequestStatus IN ('confirmed', 'failed') AND RequestCostNanoUSD > 0) AS PricedRequestCount",
      );
    });

    it("never selects a person column", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      // The ledger sits outside erasure. A person's identifier read from it
      // would outlive a deletion the rest of the product honoured.
      const query = queryOf(client);
      expect(query).not.toContain("PrincipalUserId");
      expect(query).not.toContain("EndUserId");
    });

    it("applies the window to the collapsed request, not to its versions", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const call = callOf(client);
      // No time predicate on the raw rows at all. A request's latest version
      // may have moved its start time any distance out of the window while
      // an older version's start still sits inside it — the fold sets the
      // start on admission, and nothing bounds how late an admission can
      // fold after its outcome — so any WHERE on the raw OccurredAt, however
      // widened, can keep a stale version alone and count it. The inner
      // WHERE is the tenant fence and nothing else.
      const where = call.query.slice(
        call.query.indexOf("WHERE"),
        call.query.indexOf("GROUP BY TenantId"),
      );
      expect(where).not.toMatch(/OccurredAt/);
      expect(where).not.toMatch(/prefilter/);
      // The window is decided AFTER argMax, on the surviving version, and it
      // is the read's only time predicate.
      expect(call.query).toMatch(
        /HAVING\s+RequestOccurredAt >= fromUnixTimestamp64Milli\(\{fromMs:Int64\}\)\s+AND RequestOccurredAt < fromUnixTimestamp64Milli\(\{toMs:Int64\}\)/,
      );
      expect(call.query_params.fromMs).toBe(
        Date.parse("2026-08-01T00:00:00.000Z"),
      );
      expect(call.query_params).not.toHaveProperty("prefilterFromMs");
      // Inclusive of the last day: midnight AFTER it, exclusive.
      expect(call.query_params.toMs).toBe(
        Date.parse("2026-08-08T00:00:00.000Z"),
      );
    });

    it("gives the read a deadline under the wire limit", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      // The managed client abandons a request at 30 s. A query deadline past
      // that is a deadline nothing ever reaches; one under it is the
      // difference between a screen that says it failed and one that hangs.
      expect(callOf(client).clickhouse_settings?.max_execution_time).toBe(20);
    });

    it("issues no query for an organization with no projects", async () => {
      const { client, repo } = repositoryOver([]);
      const rows = await read(repo, { ...WINDOW, tenantIds: [] });

      expect(rows).toEqual([]);
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe("when reading the ledger by day", () => {
    it("buckets on the day the request STARTED, in UTC", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysForOrganizationProjects(WINDOW);

      // A streamed answer running across midnight is one request, on the day
      // the caller asked. The server's own timezone must not move it.
      expect(queryOf(client)).toContain("toDate(RequestOccurredAt, 'UTC')");
    });

    it("decodes the driver's string integers into numbers", async () => {
      const { repo } = repositoryOver([
        {
          Day: "2026-08-01",
          AmountNanoUsd: "3500000",
          RequestCount: "3",
          PricedRequestCount: "1",
          RequestsWithoutAmount: "2",
          TokensTotal: "1200",
        },
      ]);

      const rows = await repo.sumDaysForOrganizationProjects(WINDOW);

      expect(rows).toEqual([
        {
          day: "2026-08-01",
          amountNanoUsd: 3_500_000,
          requestCount: 3,
          pricedRequestCount: 1,
          requestsWithoutAmount: 2,
          tokensTotal: 1200,
        },
      ]);
    });

    it("refuses a day past the safe integer range rather than rounding it", async () => {
      // 2^53 + 1: a Number would silently become 2^53 and a money figure would
      // lose a digit. The guarded parser throws instead, the same rule the
      // gateway's own ledger reads apply.
      const { repo } = repositoryOver([
        {
          Day: "2026-08-01",
          AmountNanoUsd: "9007199254740993",
          RequestCount: "1",
          RequestsWithoutAmount: "0",
        },
      ]);

      await expect(repo.sumDaysForOrganizationProjects(WINDOW)).rejects.toThrow(
        /safe integer range/,
      );
    });
  });

  describe("when reading the breakdowns", () => {
    it("groups by the model and by the virtual key, as the ledger names them", async () => {
      const byModel = repositoryOver([
        {
          Model: "gpt-5-mini",
          AmountNanoUsd: "10",
          RequestCount: "1",
          PricedRequestCount: "1",
          RequestsWithoutAmount: "0",
        },
      ]);
      const byKey = repositoryOver([
        {
          VirtualKeyId: "vk_1",
          AmountNanoUsd: "10",
          RequestCount: "1",
          PricedRequestCount: "1",
          RequestsWithoutAmount: "0",
        },
      ]);

      expect(await byModel.repo.sumWindowByModel(WINDOW)).toEqual([
        {
          model: "gpt-5-mini",
          amountNanoUsd: 10,
          requestCount: 1,
          pricedRequestCount: 1,
          requestsWithoutAmount: 0,
        },
      ]);
      expect(queryOf(byModel.client)).toContain("GROUP BY RequestModel");

      expect(await byKey.repo.sumWindowByVirtualKey(WINDOW)).toEqual([
        {
          virtualKeyId: "vk_1",
          amountNanoUsd: 10,
          requestCount: 1,
          pricedRequestCount: 1,
          requestsWithoutAmount: 0,
        },
      ]);
      expect(queryOf(byKey.client)).toContain("GROUP BY RequestVirtualKeyId");
    });

    it("ranks by the numeric amount, never by the string the driver ships", async () => {
      // `AmountNanoUsd` is a `toString(...)` alias so the wire never rounds a
      // wide Int64. Ordering on that alias sorts money as TEXT — seen on
      // production: "88986800" ranked above "7619357500". The ORDER BY must
      // go through a numeric expression.
      for (const [, read] of READS.slice(1)) {
        const { client, repo } = repositoryOver([]);
        await read(repo, WINDOW);
        const query = queryOf(client);
        expect(query).not.toMatch(/ORDER BY\s+AmountNanoUsd\b/);
        expect(query).toMatch(/ORDER BY\s+toInt64\(AmountNanoUsd\) DESC/);
      }
    });
  });
  /**
   * The metered token figure.
   *
   * The ledger stores a BILLABLE input count with cache already taken out of
   * it (`BillableInputTokens()` returns prompt minus cache read minus cache
   * creation), because the rating path prices each token once at its own rate.
   * That is right for money and wrong for a count, so the panel's figure adds
   * cache back and reports the work the model did. Two stored quantities are
   * SUBSETS of quantities already in the sum and would double-count; three are
   * not tokens at all.
   *
   * ADR-128 v3.18, "Supersedes Ruling 1".
   */
  describe("when reporting the metered token figure", () => {
    /** @scenario "The metered token count counts what the model read, cache included" */
    it("adds the cache the request read back to the billable remainder", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysForOrganizationProjects(WINDOW);

      const expression = meteredTokenExpression(client);
      // Without a stated figure the rule below asserts nothing.
      expect(expression).not.toBe("");
      // A prompt of 4,814 tokens with 4,736 served from cache is stored as 78.
      // A figure reading the stored column alone reports 1.6% of the tokens
      // the model processed, on the screen a customer opens to size usage.
      expect(expression).toMatch(/\bRequestTokensCacheRead\b/);
      expect(expression).toMatch(/\bRequestTokensCacheWrite\b/);
      expect(expression).toMatch(/\bRequestTokensInput\b/);
      expect(expression).toMatch(/\bRequestTokensOutput\b/);
    });

    /** @scenario "Reasoning tokens are not added on top of the output they are part of" */
    it("leaves reasoning out, counted once inside the output it belongs to", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysForOrganizationProjects(WINDOW);

      const expression = meteredTokenExpression(client);
      expect(expression).not.toBe("");
      // "it stays a subset of OutputTokens" — the emitter's own words.
      expect(expression).toMatch(/\bRequestTokensOutput\b/);
      expect(expression).not.toMatch(/Reasoning/);
    });

    /** @scenario "A longer-lived cache write is not added on top of the write it is part of" */
    it("leaves the longer-lived write out, counted once inside the cache write", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysForOrganizationProjects(WINDOW);

      const expression = meteredTokenExpression(client);
      expect(expression).not.toBe("");
      // The 1h column is the portion of the cache write that bought the longer
      // retention, normalised upward into the write itself. The word boundary
      // matters: `RequestTokensCacheWrite1h` starts with the name of the column
      // that IS counted, so a plain substring check passes on the very query
      // this rule forbids.
      expect(expression).toMatch(/\bRequestTokensCacheWrite\b/);
      expect(expression).not.toMatch(/CacheWrite1h/);
    });

    /** @scenario "The metered token count adds back the tokens that were priced separately" */
    it("adds back the audio and image tokens the rating path subtracted", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysForOrganizationProjects(WINDOW);

      const expression = meteredTokenExpression(client);
      expect(expression).not.toBe("");
      // These arrive already subtracted from the input and output counts so
      // each token is priced exactly once; a figure that skips them reports a
      // conversation as the handful of text tokens around it.
      expect(expression).toMatch(/\bRequestTokensInputAudio\b/);
      expect(expression).toMatch(/\bRequestTokensOutputAudio\b/);
      expect(expression).toMatch(/\bRequestTokensInputImage\b/);
      expect(expression).toMatch(/\bRequestTokensOutputImage\b/);

      // And the collapse has to carry them, or the aliases above name nothing.
      const query = queryOf(client);
      expect(query).toContain("argMax(TokensInputAudio, EventTimestamp)");
      expect(query).toContain("argMax(TokensOutputAudio, EventTimestamp)");
      expect(query).toContain("argMax(TokensInputImage, EventTimestamp)");
      expect(query).toContain("argMax(TokensOutputImage, EventTimestamp)");
    });

    /** @scenario "Characters, audio duration and a picture count are not tokens" */
    it("counts no characters, no audio duration and no picture count", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysForOrganizationProjects(WINDOW);

      const expression = meteredTokenExpression(client);
      expect(expression).not.toBe("");
      // Characters are what speech synthesis is priced by, milliseconds what
      // transcription is priced by, and the image count is display only —
      // nothing prices from it. None of the three is a token, and adding any
      // to a token figure reports a number in no unit at all.
      expect(expression).not.toMatch(/CharsInput/);
      expect(expression).not.toMatch(/AudioMS/);
      expect(expression).not.toMatch(/ImageCount/);
    });
  });
});
