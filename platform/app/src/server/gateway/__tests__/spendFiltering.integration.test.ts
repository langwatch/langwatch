/**
 * @vitest-environment node
 *
 * The gateway spend filter vocabulary, against real Postgres + real
 * ClickHouse.
 *
 * These pin the properties that make a filtered reconciliation trustworthy
 * rather than merely available: a narrowing that matches nothing answers
 * nothing, a team resolves to the projects it owns, and metadata written
 * before the derived column existed is still matched.
 *
 * Spec: specs/ai-gateway/gateway-spend-rest.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewaySpendEventsRepository } from "../spendEvents.clickhouse.repository";
import { clearSpendScopeCache, resolveSpendScope } from "../spendScope";

const suffix = nanoid(8);
const ORG_ID = `org-filt-${suffix}`;
const TEAM_A_ID = `team-filt-a-${suffix}`;
const TEAM_B_ID = `team-filt-b-${suffix}`;
const PROJECT_A_ID = `proj-filt-a-${suffix}`;
const PROJECT_B_ID = `proj-filt-b-${suffix}`;
const USER_ID = `usr-filt-${suffix}`;
const VK_A_ID = `vk_filt_a_${suffix}`;
const VK_B_ID = `vk_filt_b_${suffix}`;

/** A second organization, so the tenant fence has something to keep out. */
const ORG_B_ID = `org-filt-other-${suffix}`;
const TEAM_C_ID = `team-filt-c-${suffix}`;
const PROJECT_C_ID = `proj-filt-c-${suffix}`;
const VK_C_ID = `vk_filt_c_${suffix}`;

/**
 * Anchored to the run, not to a date on the calendar. The ledger keeps 13
 * months, so a fixed instant silently ages out of every window and the
 * failure would read as a filter bug years after anyone could place it.
 */
const OCCURRED_AT = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const WINDOW_FROM = OCCURRED_AT.getTime() - 24 * 60 * 60 * 1000;
const WINDOW_TO = OCCURRED_AT.getTime() + 24 * 60 * 60 * 1000;

function ch(): ClickHouseClient {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("test ClickHouse client not available");
  return client;
}

function repository(): GatewaySpendEventsRepository {
  return new GatewaySpendEventsRepository(async () => ch());
}

let eventTimestamp = 1;

async function insertSpend({
  tenantId,
  virtualKeyId,
  model,
  providerKey = "pk-openai",
  endUserId = "",
  labels = [],
  metadata = "",
  costNanoUsd = 1_000_000,
}: {
  tenantId: string;
  virtualKeyId: string;
  model: string;
  providerKey?: string;
  endUserId?: string;
  labels?: string[];
  metadata?: string;
  costNanoUsd?: number;
}): Promise<void> {
  await ch().insert({
    table: "gateway_spend",
    values: [
      {
        TenantId: tenantId,
        GatewayRequestId: `req-${nanoid(12)}`,
        OrganizationId: ORG_ID,
        VirtualKeyId: virtualKeyId,
        PrincipalUserId: "",
        EndUserId: endUserId,
        TraceId: "",
        Model: model,
        ProviderKey: providerKey,
        RequestType: "chat",
        Status: "confirmed",
        ErrorClass: "",
        HttpStatus: 200,
        NeedsReconciliation: 0,
        SettleReason: "",
        TokensInput: 100,
        TokensOutput: 50,
        TokensCacheRead: 0,
        TokensCacheWrite: 0,
        TokensReasoning: 0,
        CostNanoUSD: costNanoUsd,
        RateVersion: "v1",
        Labels: labels,
        Metadata: metadata,
        PodId: "",
        PodSeq: 0,
        DurationMS: 250,
        OccurredAt: OCCURRED_AT,
        Version: "",
        CreatedAt: 0,
        LastEventOccurredAt: 0,
        EventTimestamp: eventTimestamp++,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** Every group key the rollup served, for the whole seeded window. */
async function summariseBy(
  groupBy: Parameters<
    GatewaySpendEventsRepository["readSpendSummaries"]
  >[0]["groupBy"],
  extra: Partial<
    Parameters<GatewaySpendEventsRepository["readSpendSummaries"]>[0]
  > = {},
): Promise<string[]> {
  const page = await repository().readSpendSummaries({
    tenantIds: [PROJECT_A_ID, PROJECT_B_ID],
    groupBy,
    fromMs: WINDOW_FROM,
    toMs: WINDOW_TO,
    ...extra,
  });
  return page.rows.map((r) => r.key).sort();
}

describe("gateway spend filtering (real PG + real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();
    clearSpendScopeCache();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Filt Org ${suffix}`, slug: `filt-${suffix}` },
    });
    for (const [teamId, projectId, label] of [
      [TEAM_A_ID, PROJECT_A_ID, "a"],
      [TEAM_B_ID, PROJECT_B_ID, "b"],
    ] as const) {
      await prisma.team.create({
        data: {
          id: teamId,
          name: `Filt Team ${label} ${suffix}`,
          slug: `filt-team-${label}-${suffix}`,
          organizationId: ORG_ID,
        },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          name: `Filt Project ${label} ${suffix}`,
          slug: `filt-proj-${label}-${suffix}`,
          teamId,
          language: "en",
          framework: "openai",
          apiKey: `filt-key-${label}-${suffix}`,
        },
      });
    }
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@filt.local`, name: "Filterer" },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_A_ID,
        organizationId: ORG_ID,
        name: "filt-key-a",
        externalId: `acme-billing-${suffix}`,
        hashedSecret: `hash-${VK_A_ID}`,
        displayPrefix: "vk-lw-flt",
        createdById: USER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_A_ID }] },
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_B_ID,
        organizationId: ORG_ID,
        name: "filt-key-b",
        hashedSecret: `hash-${VK_B_ID}`,
        displayPrefix: "vk-lw-flt",
        createdById: USER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_B_ID }] },
      },
    });

    // Three models across two projects, one carrying metadata and a label.
    await insertSpend({
      tenantId: PROJECT_A_ID,
      virtualKeyId: VK_A_ID,
      model: "gpt-5-mini",
      metadata: JSON.stringify({ customer_tier: "gold", region: "eu" }),
      labels: ["billable"],
    });
    await insertSpend({
      tenantId: PROJECT_A_ID,
      virtualKeyId: VK_A_ID,
      model: "claude-opus-5",
      metadata: JSON.stringify({ customer_tier: "silver" }),
    });
    await insertSpend({
      tenantId: PROJECT_B_ID,
      virtualKeyId: VK_B_ID,
      model: "gemini-3-pro",
      providerKey: "pk-google",
      endUserId: "enduser-b",
    });

    // A second organization with real spend of its own. Without it, "a key
    // from another organization" and "a key nobody minted" are the same test.
    await prisma.organization.create({
      data: {
        id: ORG_B_ID,
        name: `Filt Other Org ${suffix}`,
        slug: `filt-other-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_C_ID,
        name: `Filt Team c ${suffix}`,
        slug: `filt-team-c-${suffix}`,
        organizationId: ORG_B_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_C_ID,
        name: `Filt Project c ${suffix}`,
        slug: `filt-proj-c-${suffix}`,
        teamId: TEAM_C_ID,
        language: "en",
        framework: "openai",
        apiKey: `filt-key-c-${suffix}`,
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_C_ID,
        organizationId: ORG_B_ID,
        name: "filt-key-c",
        hashedSecret: `hash-${VK_C_ID}`,
        displayPrefix: "vk-lw-flt",
        createdById: USER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_C_ID }] },
      },
    });
    await insertSpend({
      tenantId: PROJECT_C_ID,
      virtualKeyId: VK_C_ID,
      model: "gpt-5-mini",
    });
  });

  afterAll(async () => {
    const client = getTestClickHouseClient();
    if (client) {
      for (const tenantId of [PROJECT_A_ID, PROJECT_B_ID, PROJECT_C_ID]) {
        await client.command({
          query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenantId}'`,
        });
      }
    }
    await prisma.virtualKeyScope.deleteMany({
      where: { virtualKeyId: { in: [VK_A_ID, VK_B_ID, VK_C_ID] } },
    });
    await prisma.virtualKey.deleteMany({
      where: { organizationId: { in: [ORG_ID, ORG_B_ID] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [PROJECT_A_ID, PROJECT_B_ID, PROJECT_C_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_A_ID, TEAM_B_ID, TEAM_C_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_ID, ORG_B_ID] } },
    });
    clearSpendScopeCache();
    await stopTestContainers();
  });

  describe("when nothing is filtered", () => {
    it("covers every seeded model", async () => {
      // The negative control every filter assertion below leans on: without a
      // filter the window really does hold all three, so a narrowed result is
      // the filter working rather than the fixture being thin.
      expect(await summariseBy(["model"])).toEqual([
        "claude-opus-5",
        "gemini-3-pro",
        "gpt-5-mini",
      ]);
    });
  });

  describe("when the rollup is narrowed to the in-flight status", () => {
    /** @scenario "The rollups refuse a status they can only answer with zero" */
    it("refuses rather than answering the empty intersection", async () => {
      // The rollup drops in-flight rows with a fixed predicate, so this
      // narrowing can only ever return nothing. The REST boundary refuses it
      // by schema; this is the backstop for every other caller, because an
      // empty page here reads as "no such spend" to whatever asked.
      await expect(
        summariseBy(["model"], { filters: { status: "admitted" } }),
      ).rejects.toThrow(/admitted/);
    });

    it("still serves a status the rollup can sum", async () => {
      expect(
        await summariseBy(["model"], { filters: { status: "confirmed" } }),
      ).toEqual(["claude-opus-5", "gemini-3-pro", "gpt-5-mini"]);
    });
  });

  describe("when a filter names more than one value", () => {
    /** @scenario "A filter repeated in the query matches any of the values it names" */
    it("covers those values and no others", async () => {
      const keys = await summariseBy(["model"], {
        filters: { models: ["gpt-5-mini", "gemini-3-pro"] },
      });
      expect(keys).toEqual(["gemini-3-pro", "gpt-5-mini"]);
    });
  });

  describe("when the caller filters to one team", () => {
    /** @scenario "A team filter narrows to the projects that team owns" */
    it("sums only that team's projects", async () => {
      clearSpendScopeCache();
      const scope = await resolveSpendScope({
        organizationId: ORG_ID,
        teamIds: [TEAM_B_ID],
      });
      expect(scope.tenantIds).toEqual([PROJECT_B_ID]);

      const page = await repository().readSpendSummaries({
        tenantIds: scope.tenantIds,
        groupBy: ["model"],
        fromMs: WINDOW_FROM,
        toMs: WINDOW_TO,
      });
      expect(page.rows.map((r) => r.key)).toEqual(["gemini-3-pro"]);
    });
  });

  describe("when a filter matches nothing", () => {
    /** @scenario "A filter that matches nothing answers empty rather than everything" */
    it("answers empty rather than the whole organization", async () => {
      // The failure this guards is a present-but-empty list collapsing into
      // an absent predicate, which would hand back every row under a
      // narrowing the caller asked for.
      const keys = await summariseBy(["model"], {
        filters: { virtualKeyIds: [] },
      });
      expect(keys).toEqual([]);

      clearSpendScopeCache();
      const scope = await resolveSpendScope({
        organizationId: ORG_ID,
        externalIds: ["no-such-external-id"],
      });
      expect(scope.virtualKeyIds).toEqual([]);
    });

    /** @scenario "A filter that matches nothing answers empty rather than everything" */
    it("keeps another organization's key out even though its spend is real", async () => {
      // A key nobody minted resolves to nothing and would read as empty even
      // with no fence at all. This one exists, carries spend, and is simply
      // not ours, so only the tenant fence can keep it out.
      expect(
        await summariseBy(["model"], { filters: { virtualKeyIds: [VK_C_ID] } }),
      ).toEqual([]);

      // The row really is there, so the empty answer above is the fence and
      // not a fixture that never wrote anything.
      const theirs = await repository().readSpendSummaries({
        tenantIds: [PROJECT_C_ID],
        groupBy: ["model"],
        fromMs: WINDOW_FROM,
        toMs: WINDOW_TO,
        filters: { virtualKeyIds: [VK_C_ID] },
      });
      expect(theirs.rows.map((r) => r.key)).toEqual(["gpt-5-mini"]);
    });
  });

  describe("when the caller filters on a provider, an end user or a label", () => {
    it("narrows on each of them", async () => {
      // The seed carries these three dimensions, and a dimension nothing
      // asserts is a dimension the SQL could be building wrong.
      expect(
        await summariseBy(["model"], {
          filters: { providerKeys: ["pk-google"] },
        }),
      ).toEqual(["gemini-3-pro"]);
      expect(
        await summariseBy(["model"], {
          filters: { endUserIds: ["enduser-b"] },
        }),
      ).toEqual(["gemini-3-pro"]);
      expect(
        await summariseBy(["model"], { filters: { labels: ["billable"] } }),
      ).toEqual(["gpt-5-mini"]);
    });
  });

  describe("when the caller filters on their own metadata", () => {
    /** @scenario "Filtering on a metadata pair narrows to the requests carrying it" */
    it("covers only the requests carrying that pair", async () => {
      const keys = await summariseBy(["model"], {
        filters: { metadata: [{ key: "customer_tier", values: ["gold"] }] },
      });
      expect(keys).toEqual(["gpt-5-mini"]);
    });

    it("widens a repeated key rather than matching nothing", async () => {
      const keys = await summariseBy(["model"], {
        filters: {
          metadata: [{ key: "customer_tier", values: ["gold", "silver"] }],
        },
      });
      expect(keys).toEqual(["claude-opus-5", "gpt-5-mini"]);
    });
  });

  describe("when metadata predates the derived column", () => {
    /** @scenario "Metadata recorded before the filter shipped is still matched" */
    it("still matches rows written before the column was added", async () => {
      // The riskiest property in this work: if the server served the type
      // default for parts written before the ALTER, every historical request
      // would silently drop out of a filtered reconciliation and the books
      // would agree on a subset. Proven here against the real pinned server,
      // on a table shaped exactly like gateway_spend, so a ClickHouse upgrade
      // that changed this would fail rather than quietly under-report.
      // A table name is an identifier, not a bindable value, so it is spelled
      // into the DDL below. nanoid's alphabet includes `-`, which ends the
      // identifier mid-token and fails to parse, so roughly a fifth of runs
      // would die on a syntax error rather than on the property under test.
      const table = `gateway_spend_premigration_${suffix.replace(/[^A-Za-z0-9_]/g, "_")}`;
      const client = ch();
      await client.command({
        query: `
          CREATE TABLE ${table} (
            TenantId String, GatewayRequestId String, Metadata String DEFAULT '',
            OccurredAt DateTime64(3), EventTimestamp UInt64
          ) ENGINE = ReplacingMergeTree(EventTimestamp)
          PARTITION BY toYYYYMM(OccurredAt) ORDER BY (TenantId, GatewayRequestId)`,
      });
      try {
        await client.insert({
          table,
          values: [
            {
              TenantId: PROJECT_A_ID,
              GatewayRequestId: "req-before-the-alter",
              Metadata: JSON.stringify({ customer_tier: "gold" }),
              OccurredAt: OCCURRED_AT,
              EventTimestamp: 1,
            },
          ],
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
        });
        await client.command({
          query: `
            ALTER TABLE ${table}
              ADD COLUMN MetadataMap Map(String, String)
                MATERIALIZED JSONExtract(Metadata, 'Map(String, String)')`,
        });
        const result = await client.query({
          query: `
            SELECT count() AS matched FROM ${table} FINAL
            WHERE TenantId = {tenantId:String}
              AND MetadataMap['customer_tier'] = 'gold'`,
          query_params: { tenantId: PROJECT_A_ID },
          format: "JSONEachRow",
        });
        const [row] = (await result.json()) as Array<{ matched: string }>;
        expect(Number(row?.matched ?? 0)).toBe(1);
      } finally {
        await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      }
    });
  });

  describe("when the organization runs a project per customer", () => {
    /** @scenario "The rollup covers every project without the caller naming them" */
    it("covers every project when none is named", async () => {
      clearSpendScopeCache();
      const scope = await resolveSpendScope({ organizationId: ORG_ID });
      expect(scope.tenantIds.sort()).toEqual(
        [PROJECT_A_ID, PROJECT_B_ID].sort(),
      );
    });

    /** @scenario "Naming projects narrows the read to them" */
    it("covers only the projects named", async () => {
      clearSpendScopeCache();
      const scope = await resolveSpendScope({
        organizationId: ORG_ID,
        projectIds: [PROJECT_B_ID],
      });
      expect(scope.tenantIds).toEqual([PROJECT_B_ID]);
    });
  });
});
