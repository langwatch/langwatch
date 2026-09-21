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

  (client.user as ReturnType<typeof emptyModel>).findMany = vi.fn(
    async () => emails.map((email) => ({ email })) as never,
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

const repository: InstanceUsageStatsRepository = {
  findTraceCount: vi.fn(async () => 120),
  findScenarioRunCount: vi.fn(async () => 7),
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
      ]) {
        expect(payload, `${key} is missing`).toHaveProperty(key);
      }
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
