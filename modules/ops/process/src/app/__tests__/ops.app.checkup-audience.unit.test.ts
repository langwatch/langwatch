/**
 * Who reads what of the checkup: an install admin the details and the whole
 * install's report, everyone else the verdicts and their own organization's figures.
 * Spec: modules/ops/specs/checkup-audience.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { CheckupAnswer, CheckupResult, OpsOperator } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryCheckupProbeChannel } from "../../channels/memory/memory.checkup-probe.channel.ts";
import { MemoryUsageReportChannel } from "../../channels/memory/memory.usage-report.channel.ts";
import { MemoryDatastoreHealthRepository } from "../../repositories/memory/memory.datastore-health.repository.ts";
import { UsageReportWorld } from "../../services/__tests__/support/usage-report-peers.ts";
import { OpsCheckupService } from "../../services/ops-checkup.service.ts";
import { createOpsTestApp, OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

const STAFF: OpsOperator = { id: "user_staff", email: OPS_STAFF_ADDRESS };
const MEMBER: OpsOperator = { id: "user_member", email: "member@acme.test" };
const INSTALL_WIDE_KEYS = [
  "instance_id",
  "version",
  "install_method",
  "environment",
  "hostname",
  "auth_method",
  "connected",
];

let world: UsageReportWorld;
let switchWrites: { optionalMetricsOptOut?: boolean; hostnameOptOut?: boolean }[];

function checkupService(): OpsCheckupService {
  const datastores = MemoryDatastoreHealthRepository.create();
  return OpsCheckupService.create({
    members: {
      isSaas: false,
      serviceVersion: "3.17.0",
      publicBaseUrl: "https://langwatch.acme.test",
      nodeEnvironment: "production",
      processName: "langwatch-api",
    },
    config: {
      apiKey: undefined,
      metricsApiKey: undefined,
      clickhouseOpsUrl: undefined,
      usageStats: { disabled: false, installMethod: undefined, chartVersion: undefined },
      collectClickHouseBackupMetrics: true,
      productAnalytics: { key: undefined, host: undefined },
    },
    peers: {
      ...world.peers(),
      organizationDirectory: createApiFixture<OrganizationApi>({
        findAllIds: async () => ["org-1", "org-2"],
      }),
      licensing: createApiFixture<LicensingApi>({
        findInstanceIdentity: async () => [],
        setUsageReportSwitches: async (input) => {
          switchWrites.push(input);
        },
        getConnectDeployment: async () => ({
          permitted: true,
          connected: false,
          licenseEndpoint: "https://connect.langwatch.ai",
          gatewayEndpoint: "https://gateway.langwatch.ai",
        }),
      }),
      providerTests: createApiFixture<ModelProviderApi>(),
      projectDirectory: createApiFixture<ProjectApi>(),
      mail: { ...world.peers().mail, verifySmtp: async () => undefined },
      storage: {
        ...world.peers().storage,
        probeStorage: async () => undefined,
      },
      lwql: { findAppFunctionsProvisionable: async () => [true] },
      gateway: {
        ...world.peers().gateway,
        getDeploymentAddresses: () => ({
          baseUrl: void 0,
          publicUrl: void 0,
          expectedControlPlaneUrl: "https://langwatch.acme.test",
        }),
      },
    },
    repositories: { postgres: datastores, clickhouse: datastores, redis: datastores },
    channels: {
      usageReport: MemoryUsageReportChannel.create(),
      probes: MemoryCheckupProbeChannel.create(),
    },
  });
}

function app() {
  return createOpsTestApp({
    checkup: checkupService(),
    projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "org-1" }),
  }).app;
}

function rowsOf(answer: CheckupAnswer | CheckupResult): CheckupResult["rows"] {
  if ("deployment" in answer && answer.deployment === "saas") throw new Error("answered saas");
  if (!("rows" in answer)) throw new Error("answered no rows");
  return answer.rows;
}

function expectVerdictsOnly(rows: CheckupResult["rows"]): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(Object.keys(row).toSorted()).toEqual(["cost", "group", "id", "name", "verdict"]);
    expect(Object.keys(row.verdict)).toEqual(["outcome"]);
  }
}

beforeEach(() => {
  switchWrites = [];
  world = UsageReportWorld.create();
  world.projectsByOrganization.set("org-1", ["project-1"]);
  world.projectsByOrganization.set("org-2", ["project-2", "project-3"]);
  world.emailDomains = { "acme.test": 2, "other.test": 1 };
  world.membersByOrganization.set("org-1", ["user_member", "user_colleague"]);
  world.membersByOrganization.set("org-2", ["user_elsewhere"]);
  world.emailsByUser.set("user_member", "member@acme.test");
  world.emailsByUser.set("user_colleague", "colleague@acme.test");
  world.emailsByUser.set("user_elsewhere", "someone@other.test");
  world.signedInUserIds.add("user_member");
  world.signedInUserIds.add("user_elsewhere");
});

describe("given the caller is on the ops back-office list", () => {
  describe("when the checkup is read", () => {
    /** @scenario "An install admin reads what each check found and how to fix it" */
    it("answers every row with its detail", async () => {
      const rows = rowsOf(await app().getCheckup({ organizationId: "org-1", operator: STAFF }));

      expect(rows.find((row) => row.id === "app")?.verdict).toEqual({
        outcome: "verified",
        detail: "Release 3.17.0, running as the langwatch-api process, production environment.",
      });
      expect(rows.every((row) => typeof row.verdict.detail === "string")).toBe(true);
    });
  });

  describe("when the usage report is read", () => {
    /** @scenario "An install admin reads the whole install's usage report" */
    it("answers the whole install's report, where it goes and when", async () => {
      const report = await app().getUsageReport({ organizationId: "org-1", operator: STAFF });

      expect(report).toMatchObject({
        deployment: "self-hosted",
        endpoint: "https://app.langwatch.ai/api/track_usage",
        switches: { optional: true, hostname: true },
        disabled: false,
        payload: { organizations: 2, projects: 3, version: "3.17.0" },
      });
    });
  });

  describe("when the usage report switches are changed", () => {
    /** @scenario "An install admin changes what the install reports" */
    it("writes the switches and answers the whole install's report", async () => {
      const report = await app().setUsageReportSwitches({
        organizationId: "org-1",
        operator: STAFF,
        hostnameOptOut: true,
      });

      expect(switchWrites).toEqual([{ hostnameOptOut: true }]);
      expect(report).toMatchObject({
        deployment: "self-hosted",
        switches: { optional: true, hostname: true },
        payload: { organizations: 2, projects: 3 },
      });
    });
  });
});

describe("given the caller is signed in and not on the ops back-office list", () => {
  describe("when the checkup is read and its paid checks are run", () => {
    /** @scenario "An organization member reads each check's verdict and nothing more" */
    it("answers each row's name, group, cost and outcome only", async () => {
      const opsApp = app();

      const read = rowsOf(await opsApp.getCheckup({ organizationId: "org-1", operator: MEMBER }));
      const ran = rowsOf(
        await opsApp.runCheckup({
          organizationId: "org-1",
          operator: MEMBER,
          checks: ["reach_connect_host", "storage_probe"],
        }),
      );

      expectVerdictsOnly(read);
      expectVerdictsOnly(ran);
      expect(read.find((row) => row.id === "app")).toEqual({
        id: "app",
        name: "Application",
        group: "install",
        cost: "free",
        verdict: { outcome: "verified" },
      });
    });

    it("reads a signed-out caller the same way", async () => {
      expectVerdictsOnly(
        rowsOf(await app().getCheckup({ organizationId: "org-1", operator: null })),
      );
    });
  });

  describe("when the usage report is read", () => {
    /** @scenario "An organization member reads a usage report for their own organization" */
    it("counts the caller's organization only and carries nothing install-wide", async () => {
      const report = await app().getUsageReport({ organizationId: "org-1", operator: MEMBER });

      if (report.deployment !== "self-hosted") throw new Error("answered saas");
      expect(report.payload).toMatchObject({ organizations: 1, projects: 1 });
      for (const key of INSTALL_WIDE_KEYS) expect(report.payload).not.toHaveProperty(key);
      expect(report).not.toHaveProperty("endpoint");
      expect(report).not.toHaveProperty("switches");
    });

    /** @scenario "An organization's report counts its own members' sign-ins and email domains" */
    it("counts signed-in users and email domains among the organization's members only", async () => {
      const report = await app().getUsageReport({ organizationId: "org-1", operator: MEMBER });

      if (report.deployment !== "self-hosted") throw new Error("answered saas");
      expect(report.payload).toMatchObject({
        active_users_28d: 1,
        user_email_domains: { "acme.test": 2 },
      });
    });
  });

  describe("when the usage report switches are changed", () => {
    /** @scenario "Only an install admin changes what the install reports" */
    it("refuses as operator-only and writes nothing", async () => {
      await expect(
        app().setUsageReportSwitches({
          organizationId: "org-1",
          operator: MEMBER,
          hostnameOptOut: true,
        }),
      ).rejects.toMatchObject({ code: "permission_denied" });
      await expect(
        app().setUsageReportSwitches({ organizationId: "org-1", operator: null }),
      ).rejects.toMatchObject({ code: "permission_denied" });
      expect(switchWrites).toEqual([]);
    });
  });
});

describe("given the caller presents a project API key", () => {
  describe("when the checkup is read over REST", () => {
    /** @scenario "A project API key is never an install admin" */
    it("answers verdicts and its organization's figures only", async () => {
      const opsApp = app();

      const report = await opsApp.getProjectCheckup({ projectId: "project-1" });
      const ran = await opsApp.runProjectCheckup({
        projectId: "project-1",
        checks: ["reach_connect_host"],
      });

      expectVerdictsOnly(report.rows);
      expectVerdictsOnly(ran.rows);
      expect(Object.keys(report.usageReport).toSorted()).toEqual(["payload", "schemaVersion"]);
      expect(report.usageReport.payload).toMatchObject({ organizations: 1, projects: 1 });
    });
  });
});
