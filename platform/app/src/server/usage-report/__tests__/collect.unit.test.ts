/**
 * The report one install would send right now.
 *
 * What is pinned here is what a customer would check: that switching the
 * optional category off actually removes it, that hostname goes on its own,
 * that the identity carries nothing about the customer, and that email
 * domains arrive as counts rather than as addresses.
 *
 * @see ../collect.ts
 * @see specs/self-hosting/connected-services/usage-report.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import type { InstanceUsageStatsRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import { collectUsageReport } from "../collect";
import { USAGE_FIELDS } from "../dictionary";

const env = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("~/env.mjs", () => ({ env }));
vi.mock("@ee/licensing/connect/install/connectEntitlement", () => ({
  licenseConnectServices: ({ licenseKey }: { licenseKey: string | null }) =>
    licenseKey === "a-connected-license" ? ["instant_evals"] : [],
}));

const NOW = new Date("2026-09-21T12:00:00.000Z");
const INSTANCE_ID = "3f1c2b40-9a7e-4f2a-8f4c-6b1f0c2d9e77";

/** A model that answers every count and lookup with nothing. */
function emptyModel() {
  return {
    count: vi.fn(async () => 0),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    groupBy: vi.fn(async () => []),
  };
}

const MODELS = [
  "annotation",
  "annotationQueue",
  "annotationQueueItem",
  "annotationScore",
  "batchEvaluation",
  "customGraph",
  "dataset",
  "datasetRecord",
  "experiment",
  "githubPullRequest",
  "langyConversationProjection",
  "langyConversationTurnProjection",
  "llmPromptConfig",
  "modelProvider",
  "monitor",
  "organizationUser",
  "session",
  "team",
  "trigger",
  "user",
  "workflow",
] as const;

function prismaOver({
  emails = [] as string[],
  license = null as string | null,
  projectIds = ["project-1"],
} = {}): PrismaClient {
  const client: Record<string, unknown> = {};
  for (const name of MODELS) client[name] = emptyModel();

  // Email domains are grouped by Postgres, so the stand-in answers the raw
  // query the way the database would: one row per domain with its count, and
  // never an address.
  const grouped = new Map<string, number>();
  for (const email of emails) {
    const domain = email.split("@")[1]?.toLowerCase().trim();
    if (!domain) continue;
    grouped.set(domain, (grouped.get(domain) ?? 0) + 1);
  }
  client.$queryRaw = vi.fn(async () =>
    [...grouped].map(([domain, count]) => ({ domain, count })),
  );
  client.project = {
    ...emptyModel(),
    findMany: vi.fn(async () => projectIds.map((id) => ({ id })) as never),
  };
  client.organization = {
    ...emptyModel(),
    findMany: vi.fn(async () => [{ license, ssoProvider: null }] as never),
  };

  return client as unknown as PrismaClient;
}

/**
 * A ClickHouse that answers the same figure for every stretch of time, and
 * reached each rung on a day that depends on the organization asked, so the
 * report's "earliest across organizations" has something to choose between.
 */
const repository: InstanceUsageStatsRepository = {
  findTraceCount: vi.fn(async () => 120),
  findScenarioRunCount: vi.fn(async () => 7),
  findSpanCount: vi.fn(async () => 900),
  findGatewaySpend: vi.fn(async () => ({ requests: 30, spendUsd: 1.25 })),
  findInstantEvalRunCount: vi.fn(async () => 4),
  findInstantEvalJudgmentCount: vi.fn(async () => 400),
  findCodingAgentSessionCount: vi.fn(async () => 11),
  findFirstGatewayRequestAt: vi.fn(async ({ organizationId }) =>
    organizationId === "org-2"
      ? new Date("2026-02-01T00:00:00.000Z")
      : new Date("2026-03-01T00:00:00.000Z"),
  ),
  findFirstInstantEvalRunAt: vi.fn(async () => null),
  findFirstCodingAgentSessionAt: vi.fn(async ({ organizationId }) =>
    organizationId === "org-1" ? new Date("2026-04-01T00:00:00.000Z") : null,
  ),
};

function report(overrides: Parameters<typeof collectUsageReport>[0]) {
  return collectUsageReport({ now: NOW, ...overrides });
}

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  process.env.BASE_HOST = "langwatch.acme.test";
  process.env.SERVICE_VERSION = "3.17.0";
});

describe("given an install with the report switched fully on", () => {
  describe("when the report is taken", () => {
    /** @scenario "Every field the report carries declares a category and a reason" */
    it("carries only fields the dictionary declares", async () => {
      const declared = new Set(USAGE_FIELDS.map((field) => field.key));

      const payload = await report({
        prisma: prismaOver(),
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        repository,
      });

      const undeclared = Object.keys(payload).filter(
        (key) => !declared.has(key),
      );
      expect(undeclared).toEqual([]);
    });

    /** @scenario "The report names the install and not its organizations" */
    it("names the install by its minted identity and nothing else", async () => {
      const payload = await report({
        prisma: prismaOver(),
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      expect(payload.instance_id).toBe(INSTANCE_ID);
      expect(JSON.stringify(payload)).not.toContain("org-1");
    });

    /** @scenario "Company identity travels as aggregated domains, never an address" */
    it("counts email domains and carries no address", async () => {
      const payload = await report({
        prisma: prismaOver({
          emails: ["ada@acme.test", "grace@acme.test", "kay@other.test"],
        }),
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      expect(payload.user_email_domains).toEqual({
        "acme.test": 2,
        "other.test": 1,
      });
      expect(JSON.stringify(payload)).not.toContain("ada@");
    });

    it("reports what its license names it may call", async () => {
      const payload = await report({
        prisma: prismaOver({ license: "a-connected-license" }),
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      expect(payload.connected).toBe(true);
    });

    it("counts what ClickHouse holds for every organization it carries", async () => {
      const payload = await report({
        prisma: prismaOver(),
        organizationIds: ["org-1", "org-2"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      expect(payload.totalTraces).toBe(240);
      expect(payload.totalScenarioEvents).toBe(14);
    });

    it("adds up spans, gateway traffic, Instant Evals and agent sessions over every organization", async () => {
      const payload = await report({
        prisma: prismaOver(),
        organizationIds: ["org-1", "org-2"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      expect(payload).toMatchObject({
        spans: 1800,
        spans_7d: 1800,
        spans_28d: 1800,
        gateway_requests: 60,
        gateway_requests_28d: 60,
        gateway_spend_usd: 2.5,
        gateway_spend_usd_7d: 2.5,
        instant_eval_runs: 8,
        instant_eval_judgments_7d: 800,
        coding_agent_sessions_28d: 22,
      });
    });

    it("dates each ClickHouse rung from the earliest organization, and null where none reached it", async () => {
      const payload = await report({
        prisma: prismaOver(),
        organizationIds: ["org-1", "org-2"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      expect(payload.first_gateway_request_at).toBe("2026-02-01T00:00:00.000Z");
      expect(payload.first_coding_agent_session_at).toBe(
        "2026-04-01T00:00:00.000Z",
      );
      expect(payload.first_instant_eval_run_at).toBeNull();
      expect(payload.first_langy_turn_at).toBeNull();
    });
  });
});

describe("given a customer who switched the optional category off", () => {
  describe("when the report is taken", () => {
    /** @scenario "Switching the optional category off removes it from the report" */
    it("still says which release runs and how big the install is", async () => {
      const payload = await report({
        prisma: prismaOver({ emails: ["ada@acme.test"] }),
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
        switches: { optional: false, hostname: false },
      });

      expect(payload.version).toBe("3.17.0");
      expect(payload.projects).toBe(1);
      expect(payload.user_email_domains).toBeUndefined();
      expect(payload.hostname).toBeUndefined();
      expect(payload.totalTraces).toBeUndefined();
      expect(payload.first_project_at).toBeUndefined();
    });
  });
});

describe("given a customer who switched hostname off and nothing else", () => {
  describe("when the report is taken", () => {
    /** @scenario "Hostname has a switch of its own" */
    it("keeps the rest of the optional category", async () => {
      const payload = await report({
        prisma: prismaOver({ emails: ["ada@acme.test"] }),
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
        switches: { optional: true, hostname: false },
      });

      expect(payload.hostname).toBeUndefined();
      expect(payload.user_email_domains).toEqual({ "acme.test": 1 });
    });
  });
});

describe("given a figure that is counted over time", () => {
  describe("when the report is taken", () => {
    /** @scenario "Counts are reported lifetime and over two windows" */
    it("carries it three times: lifetime, seven days and twenty-eight", async () => {
      const payload = await report({
        prisma: prismaOver(),
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      for (const key of [
        "annotations",
        "annotations_7d",
        "annotations_28d",
        "datasets",
        "datasets_7d",
        "datasets_28d",
        "totalTraces",
        "traces_7d",
        "traces_28d",
        "langy_users",
        "langy_active_users_7d",
        "langy_active_users_28d",
        "pull_requests",
        "pull_requests_7d",
        "pull_requests_28d",
      ]) {
        expect(payload, `${key} is missing`).toHaveProperty(key);
      }
    });
  });
});

describe("given an install with an organization and no project yet", () => {
  describe("when the report is taken", () => {
    it("still reports, without the figures a project would scope", async () => {
      const client = prismaOver({
        emails: ["ada@acme.test"],
        projectIds: [],
      });

      const payload = await report({
        prisma: client,
        organizationIds: ["org-1"],
        instanceId: INSTANCE_ID,
        firstSeenAt: null,
        repository,
      });

      expect(payload.projects).toBe(0);
      expect(payload.user_email_domains).toEqual({ "acme.test": 1 });
      expect(payload.annotations).toBeUndefined();
      expect(payload.first_project_at).toBeUndefined();
      // No project-scoped model was asked with an empty list, which is what
      // the tenancy guard would have refused.
      const models = client as unknown as Record<string, { count: unknown }>;
      expect(models.annotation?.count).not.toHaveBeenCalled();
    });
  });
});

describe("given an install carrying no organization", () => {
  describe("when the report is taken", () => {
    it("refuses, because there is nothing to report", async () => {
      await expect(
        report({
          prisma: prismaOver(),
          organizationIds: [],
          instanceId: INSTANCE_ID,
          firstSeenAt: null,
          repository,
        }),
      ).rejects.toThrow(
        "an install with no organization has nothing to report",
      );
    });
  });
});
