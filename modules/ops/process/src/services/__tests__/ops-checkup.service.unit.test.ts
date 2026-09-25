/**
 * The checkup's facts, each answered by the module that owns it.
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { GatewayDeploymentAddresses } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OpsServerConfig } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Project } from "@langwatch/project-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryCheckupProbeChannel } from "../../channels/memory/memory.checkup-probe.channel.ts";
import { MemoryUsageReportChannel } from "../../channels/memory/memory.usage-report.channel.ts";
import { MemoryDatastoreHealthRepository } from "../../repositories/memory/memory.datastore-health.repository.ts";
import { OpsCheckupService } from "../ops-checkup.service.ts";
import { UsageReportWorld } from "./support/usage-report-peers.ts";

const CONFIG: OpsServerConfig = {
  apiKey: undefined,
  metricsApiKey: undefined,
  clickhouseOpsUrl: undefined,
  usageStats: { disabled: false, installMethod: undefined, chartVersion: undefined },
  collectClickHouseBackupMetrics: true,
  productAnalytics: { key: undefined, host: undefined },
};

const PROJECT: Project = {
  id: "project-1",
  name: "Chatbot",
  slug: "chatbot",
  apiKey: "sk-lw-test",
  lwqlKey: "lwql-test",
  teamId: "team-1",
  language: "python",
  framework: "openai",
  kind: "application",
  firstMessage: true,
  integrated: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
};

let datastores: MemoryDatastoreHealthRepository;
let world: UsageReportWorld;
let probedProjects: string[];
let provisionable: boolean[];
let probes: MemoryCheckupProbeChannel;
let gatewayAddresses: GatewayDeploymentAddresses;

function checkup() {
  return service().checkupFor({ organizationId: "org-1", requestedBy: "user-1" });
}

function service() {
  return OpsCheckupService.create({
    members: {
      isSaas: false,
      serviceVersion: "3.17.0",
      publicBaseUrl: "https://langwatch.acme.test",
      nodeEnvironment: "production",
      processName: "langwatch-api",
    },
    config: CONFIG,
    peers: {
      ...world.peers(),
      organizationDirectory: createApiFixture<OrganizationApi>({
        findAllIds: async () => ["org-1"],
      }),
      licensing: createApiFixture<LicensingApi>({
        findInstanceIdentity: async () => [],
        getConnectDeployment: async () => ({
          permitted: true,
          connected: false,
          licenseEndpoint: "https://connect.langwatch.ai",
          gatewayEndpoint: "https://gateway.langwatch.ai",
        }),
      }),
      providerTests: createApiFixture<ModelProviderApi>(),
      projectDirectory: {
        listByOrganization: async ({ page, limit }) => ({
          data: [PROJECT],
          pagination: { page, limit, total: 1 },
        }),
      },
      mail: {
        getMailDelivery: async () => ({ provider: "smtp", smtpConfigured: true }),
        verifySmtp: async () => {
          throw new Error("535 authentication failed");
        },
      },
      storage: {
        getStorageDestination: async () => ({ kind: "s3", bucket: "langwatch-objects" }),
        probeStorage: async ({ projectId }) => {
          probedProjects.push(projectId);
        },
      },
      lwql: { findAppFunctionsProvisionable: async () => provisionable },
      gateway: { ...world.peers().gateway, getDeploymentAddresses: () => gatewayAddresses },
    },
    repositories: { postgres: datastores, clickhouse: datastores, redis: datastores },
    channels: {
      usageReport: MemoryUsageReportChannel.create(),
      probes,
    },
  });
}

async function verdictOf(id: string) {
  const { rows } = await checkup().cheap();
  return rows.find((row) => row.id === id)?.verdict;
}

beforeEach(() => {
  datastores = MemoryDatastoreHealthRepository.create();
  world = UsageReportWorld.create();
  probedProjects = [];
  provisionable = [true];
  probes = MemoryCheckupProbeChannel.create();
  gatewayAddresses = {
    baseUrl: void 0,
    publicUrl: void 0,
    expectedControlPlaneUrl: "https://langwatch.acme.test",
  };
});

describe("OpsCheckupService", () => {
  describe("given a release migration the ledger never finished", () => {
    it("names it as pending, and a started one as failed", async () => {
      datastores.releaseMigrations.push("0_init", "20260101_add", "20260102_more");
      datastores.ledger.push(
        { name: "0_init", finished: true, rolledBack: false },
        { name: "20260102_more", finished: false, rolledBack: false },
      );

      const verdict = await verdictOf("postgres_migrations");

      expect(verdict).toMatchObject({
        outcome: "refused",
        code: "checkup_postgres_migration_failed",
      });
    });

    it("reads as not checked where the release's folder is not on the install", async () => {
      await expect(verdictOf("postgres_migrations")).resolves.toMatchObject({
        outcome: "unchecked",
      });
    });
  });

  describe("given goose reports a pending ClickHouse migration", () => {
    it("refuses with the pending count", async () => {
      datastores.migrationStatus = "Applied  00001_init.sql\nPending -- 00002_more.sql";

      await expect(verdictOf("clickhouse_migrations")).resolves.toMatchObject({
        outcome: "refused",
        code: "checkup_clickhouse_migrations_pending",
      });
    });
  });

  describe("given ClickHouse did not answer the provisioning probe", () => {
    it("reads LangWatchQL's functions as not checked", async () => {
      provisionable = [];

      await expect(verdictOf("lwql")).resolves.toMatchObject({ outcome: "unchecked" });
    });
  });

  describe("given the oldest project writes to S3", () => {
    it("names the bucket, and the write probe writes for that project", async () => {
      await expect(verdictOf("storage")).resolves.toMatchObject({
        outcome: "verified",
        detail: "Stored objects go to S3 bucket langwatch-objects.",
      });

      const { rows } = await checkup().explicit({ checks: ["storage_probe"] });

      expect(rows.find((row) => row.id === "storage_probe")?.verdict.outcome).toBe("verified");
      expect(probedProjects).toEqual(["project-1"]);
    });
  });

  describe("given mail goes through an SMTP relay that refuses the login", () => {
    it("names the gateway, and the connection check carries the refusal", async () => {
      await expect(verdictOf("email")).resolves.toMatchObject({
        outcome: "verified",
        detail: "Email goes through smtp.",
      });

      const { rows } = await checkup().explicit({ checks: ["smtp_verify"] });

      expect(rows.find((row) => row.id === "smtp_verify")?.verdict).toMatchObject({
        outcome: "refused",
      });
    });
  });

  describe("given the usage report names whether a gateway is configured", () => {
    /** @scenario "The usage report says whether an AI Gateway is configured" */
    it("reports false without a gateway address and true with one", async () => {
      const without = await service().usageReports.preview();
      gatewayAddresses = { ...gatewayAddresses, baseUrl: "http://gateway:5563" };
      const withGateway = await service().usageReports.preview();

      expect(without.payload.gateway_configured).toBe(false);
      expect(withGateway.payload.gateway_configured).toBe(true);
    });
  });

  describe("given the gateway address the gateway module answers", () => {
    it("reads the gateway as not checked where none is configured", async () => {
      await expect(verdictOf("gateway")).resolves.toMatchObject({ outcome: "unchecked" });
    });

    it("verifies a gateway whose health route answers", async () => {
      gatewayAddresses = { ...gatewayAddresses, baseUrl: "http://gateway:5563" };

      await expect(verdictOf("gateway")).resolves.toMatchObject({ outcome: "verified" });
      expect(probes.asked).toContain("http://gateway:5563/healthz");
    });

    it("refuses a gateway that reports another install as its control plane", async () => {
      gatewayAddresses = { ...gatewayAddresses, baseUrl: "http://gateway:5563" };
      probes.answers.set("http://gateway:5563/debug/control-plane", {
        status: 200,
        body: { control_plane_base_url: "https://someone-else.test" },
      });

      const { rows } = await checkup().explicit({ checks: ["gateway_control_plane"] });

      expect(rows.find((row) => row.id === "gateway_control_plane")?.verdict).toMatchObject({
        outcome: "refused",
        code: "checkup_gateway_control_plane_mismatch",
      });
    });
  });
});
