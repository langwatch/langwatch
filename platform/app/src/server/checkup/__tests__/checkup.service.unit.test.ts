/**
 * The checkup decides from injected facts, so each scenario states the world
 * in a few lines and reads the verdict.
 *
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { ConnectUnreachableError } from "@ee/licensing/connect/install/connectErrors";
import { describe, expect, it, vi } from "vitest";
import { ModelProviderTestRateLimitedError } from "~/server/modelProviders/errors";

import {
  type CheckupDeps,
  CheckupService,
  type ConnectView,
} from "../checkup.service";
import {
  CHECK_DEFINITIONS,
  CHECK_OUTCOMES,
  type CheckId,
  explicitCheckIds,
  freeCheckIds,
} from "../verdict";

const NOW = new Date("2026-09-21T10:00:00.000Z");

const CONNECTED: ConnectView = {
  deployment: "on",
  licensed: true,
  entitledServices: ["instant_evals"],
  lastSyncAt: "2026-09-21T09:00:00.000Z",
  lastSyncError: null,
  licenseHost: "https://connect.langwatch.ai",
  gatewayHost: "https://gateway.langwatch.ai",
};

function healthyDeps(overrides: Partial<CheckupDeps> = {}): CheckupDeps {
  return {
    organizationId: "org_1",
    now: () => NOW,
    install: {
      version: "2026.9.3",
      processRole: "all",
      environment: "production",
    },
    postgres: {
      ping: async () => "18.1",
      migrations: async () => ({ pending: [], failed: [] }),
    },
    clickhouse: {
      configured: true,
      ping: async () => undefined,
      migrationStatus: async () =>
        "    Applied At    Migration\n    2026-09-01    -- 00001_x.sql\n",
      appFunctionsProvisionable: async () => true,
    },
    redis: { target: "redis://redis:6379", ready: async () => undefined },
    gateway: {
      baseUrl: "http://gateway:5563",
      expectedControlPlaneUrl: "http://app:5560",
      health: async () => undefined,
      probeControlPlane: async () => ({
        kind: "ok",
        controlPlaneBaseUrl: "http://app:5560",
      }),
    },
    license: async () => ({
      hasLicense: true,
      valid: true,
      planName: "Enterprise",
      expiresAt: "2027-09-21T00:00:00.000Z",
      currentMembers: 12,
      maxMembers: 50,
    }),
    connect: async () => CONNECTED,
    identity: async () => ({
      instanceId: "4b1c",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      lastReportAt: new Date("2026-09-20T12:00:00.000Z"),
      lastReportError: null,
      optionalMetricsOptOut: false,
      hostnameOptOut: false,
    }),
    usageReportsDisabled: false,
    usageReportEndpoint: async () => "https://connect.langwatch.ai/v1/stats",
    reach: async () => undefined,
    storage: {
      destination: async () => "S3 bucket langwatch-objects",
      probe: async () => undefined,
    },
    email: {
      provider: "smtp",
      smtpConfigured: true,
      verifySmtp: async () => undefined,
    },
    modelProviders: async () => [
      { id: "mp_1", provider: "openai", customKeys: { OPENAI_API_KEY: "sk" } },
    ],
    modelProviderBudget: async () => undefined,
    testModelProvider: async () => ({ outcome: "verified" }),
    canary: async () => ({ status: 200, body: { status: 200 } }),
    ...overrides,
  };
}

function rowOf(rows: { id: CheckId; verdict: unknown }[], id: CheckId) {
  const row = rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row.verdict as {
    outcome: string;
    detail: string;
    fix?: string;
    code?: string;
    docsPath?: string;
    meta?: Record<string, unknown>;
  };
}

describe("CheckupService", () => {
  describe("given every dependency answers", () => {
    /** @scenario "Every row carries one of the three verdicts" */
    it("carries one of the three verdicts on every row and loses none", async () => {
      const { rows } = await new CheckupService(healthyDeps()).cheap();

      expect(rows.map((row) => row.id)).toEqual(
        CHECK_DEFINITIONS.map((definition) => definition.id),
      );
      for (const row of rows) {
        expect(CHECK_OUTCOMES).toContain(row.verdict.outcome);
      }
    });

    /** @scenario "The install row names the release and the process role" */
    it("names the release and the process role on the install row", async () => {
      const { rows } = await new CheckupService(healthyDeps()).cheap();
      const verdict = rowOf(rows, "app");

      expect(verdict.outcome).toBe("verified");
      expect(verdict.detail).toContain("2026.9.3");
      expect(verdict.detail).toContain("all");
    });

    /** @scenario "The explicit checks do not run on page load" */
    it("keeps every explicit check not checked on the cheap run and opens no connection", async () => {
      const reach = vi.fn(async () => undefined);
      const canary = vi.fn(async () => ({ status: 200, body: {} }));
      const { rows } = await new CheckupService(
        healthyDeps({ reach, canary }),
      ).cheap();

      expect(reach).not.toHaveBeenCalled();
      expect(canary).not.toHaveBeenCalled();
      for (const id of explicitCheckIds()) {
        const verdict = rowOf(rows, id);
        expect(verdict.outcome).toBe("unchecked");
        expect(verdict.detail).toContain("Not run");
      }
      for (const id of freeCheckIds()) {
        expect(rowOf(rows, id).outcome).toBe("verified");
      }
    });

    /** @scenario "A connected install shows its last sync" */
    it("shows the last sync on a connected install", async () => {
      const { rows } = await new CheckupService(healthyDeps()).cheap();
      const verdict = rowOf(rows, "connect");

      expect(verdict.outcome).toBe("verified");
      expect(verdict.detail).toContain("2026-09-21T09:00:00.000Z");
    });
  });

  describe("when a probe throws before it can answer", () => {
    /** @scenario "A check that could not run reads as not checked, never as a pass" */
    it("reads not checked with the reason", async () => {
      const deps = healthyDeps({
        storage: {
          destination: async () => {
            throw new Error("the project table is locked");
          },
          probe: async () => undefined,
        },
      });
      const { rows } = await new CheckupService(deps).cheap();
      const verdict = rowOf(rows, "storage");

      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("the project table is locked");
    });
  });

  describe("when Postgres answers but a migration is pending", () => {
    /** @scenario "A failed check names the fix and the page that explains it" */
    it("fails the migrations row with the command and a docs page", async () => {
      const deps = healthyDeps({
        postgres: {
          ping: async () => "18.1",
          migrations: async () => ({
            pending: ["20260921170000_instance_identity_startup_notice"],
            failed: [],
          }),
        },
      });
      const { rows } = await new CheckupService(deps).cheap();
      const verdict = rowOf(rows, "postgres_migrations");

      expect(verdict.outcome).toBe("refused");
      expect(verdict.fix).toContain("prisma migrate deploy");
      expect(verdict.docsPath).toMatch(/^\/self-hosting\//);
      expect(rowOf(rows, "postgres").outcome).toBe("verified");
    });
  });

  describe("when Redis does not answer", () => {
    /** @scenario "Redis that does not answer is a fail with the address it was tried at" */
    it("fails the Redis row and names the address", async () => {
      const deps = healthyDeps({
        redis: {
          target: "redis://cache.internal:6379",
          ready: async () => {
            throw new Error("connect ECONNREFUSED");
          },
        },
      });
      const { rows } = await new CheckupService(deps).cheap();
      const verdict = rowOf(rows, "redis");

      expect(verdict.outcome).toBe("refused");
      expect(verdict.detail).toContain("redis://cache.internal:6379");
    });
  });

  describe("when the goose binary is absent", () => {
    /** @scenario "A ClickHouse install where the goose binary is absent leaves migrations not checked" */
    it("passes ClickHouse and leaves its migrations not checked", async () => {
      const deps = healthyDeps({
        clickhouse: {
          configured: true,
          ping: async () => undefined,
          migrationStatus: async () => {
            throw new Error("Goose binary not found");
          },
          appFunctionsProvisionable: async () => true,
        },
      });
      const { rows } = await new CheckupService(deps).cheap();

      expect(rowOf(rows, "clickhouse").outcome).toBe("verified");
      const migrations = rowOf(rows, "clickhouse_migrations");
      expect(migrations.outcome).toBe("unchecked");
      expect(migrations.detail).toContain("Goose binary not found");
    });
  });

  describe("when the last usage report was refused", () => {
    /** @scenario "The usage report row reads the last report and its refusal" */
    it("fails the usage report row and names the refusal", async () => {
      const deps = healthyDeps({
        identity: async () => ({
          instanceId: "4b1c",
          createdAt: NOW,
          lastReportAt: null,
          lastReportError: "usage_report_refused_413",
          optionalMetricsOptOut: false,
          hostnameOptOut: false,
        }),
      });
      const { rows } = await new CheckupService(deps).cheap();
      const verdict = rowOf(rows, "usage_report");

      expect(verdict.outcome).toBe("refused");
      expect(verdict.code).toBe("usage_report_refused_413");
      expect(verdict.detail).toContain("usage_report_refused_413");
      expect(verdict.detail).toContain("connect.langwatch.ai");
    });
  });

  describe("when usage reporting is switched off", () => {
    /** @scenario "Usage reporting switched off is not checked rather than failed" */
    it("reads not checked and names DISABLE_USAGE_STATS", async () => {
      const deps = healthyDeps({ usageReportsDisabled: true });
      const { rows } = await new CheckupService(deps).cheap();
      const verdict = rowOf(rows, "usage_report");

      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("DISABLE_USAGE_STATS");
    });
  });

  describe("when the license names no hosted service", () => {
    /** @scenario "A license that names no hosted service leaves the connect rows unblocked rather than failed" */
    it("leaves the connect row not checked with the unblock", async () => {
      const deps = healthyDeps({
        connect: async () => ({
          ...CONNECTED,
          licensed: false,
          entitledServices: null,
          lastSyncAt: null,
        }),
      });
      const { rows } = await new CheckupService(deps).cheap();
      const verdict = rowOf(rows, "connect");

      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("Instant Evals");
      expect(verdict.fix).toContain("activation code");
    });
  });

  describe("when the deployment sets LANGWATCH_CONNECT_DISABLED", () => {
    /** @scenario "Connect switched off by the deployment is not checked with the variable named" */
    it("reads not checked and names the variable", async () => {
      const deps = healthyDeps({
        connect: async () => ({
          ...CONNECTED,
          deployment: "off",
          licensed: false,
          entitledServices: null,
          lastSyncAt: null,
        }),
      });
      const { rows } = await new CheckupService(deps).cheap();
      const verdict = rowOf(rows, "connect");

      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("LANGWATCH_CONNECT_DISABLED");
    });
  });

  describe("when the connect host cannot be reached", () => {
    /** @scenario "Reaching the connect host names the host and port a firewall rule must allow" */
    it("fails with connect_unreachable naming host and port", async () => {
      const deps = healthyDeps({
        reach: async (url) => {
          throw new ConnectUnreachableError({
            host: new URL(url).hostname,
            port: 443,
          });
        },
      });
      const { rows } = await new CheckupService(deps).explicit({
        checks: ["reach_connect_host"],
      });
      const verdict = rowOf(rows, "reach_connect_host");

      expect(verdict.outcome).toBe("refused");
      expect(verdict.code).toBe("connect_unreachable");
      expect(verdict.detail).toContain("connect.langwatch.ai");
      expect(verdict.detail).toContain("443");
      expect(verdict.meta).toMatchObject({
        host: "connect.langwatch.ai",
        port: 443,
      });
    });
  });

  describe("when the gateway host answers 404", () => {
    /** @scenario "A host that answers with any status is reachable" */
    it("passes the gateway host row", async () => {
      const reach = vi.fn(async () => undefined);
      const { rows } = await new CheckupService(
        healthyDeps({ reach }),
      ).explicit({ checks: ["reach_gateway_host"] });

      expect(reach).toHaveBeenCalledWith("https://gateway.langwatch.ai");
      expect(rowOf(rows, "reach_gateway_host").outcome).toBe("verified");
      expect(rowOf(rows, "reach_connect_host").outcome).toBe("unchecked");
    });
  });

  describe("when the model provider test budget is used up", () => {
    /** @scenario "The model provider test respects the organization's egress budget" */
    it("leaves the row not checked and names when to try again", async () => {
      const testModelProvider = vi.fn(async () => ({
        outcome: "verified" as const,
      }));
      const deps = healthyDeps({
        modelProviderBudget: async () => {
          throw new ModelProviderTestRateLimitedError({
            retryAfterSeconds: 42,
          });
        },
        testModelProvider,
      });
      const { rows } = await new CheckupService(deps).explicit({
        checks: ["model_provider_test"],
      });
      const verdict = rowOf(rows, "model_provider_test");

      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("42 seconds");
      expect(testModelProvider).not.toHaveBeenCalled();
    });
  });

  describe("when the storage destination accepts writes", () => {
    /** @scenario "The storage probe writes and deletes one object" */
    it("writes and deletes one object and passes", async () => {
      const probe = vi.fn(async () => undefined);
      const { rows } = await new CheckupService(
        healthyDeps({
          storage: { destination: async () => "S3 bucket b", probe },
        }),
      ).explicit({ checks: ["storage_probe"] });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(rowOf(rows, "storage_probe").outcome).toBe("verified");
    });
  });

  describe("when no scenario run plan was named", () => {
    /** @scenario "A canary that needs an input it was not given is not checked" */
    it("leaves the scenarios row not checked and says which input it needs", async () => {
      const canary = vi.fn(async () => ({ status: 200, body: {} }));
      const { rows } = await new CheckupService(
        healthyDeps({ canary }),
      ).explicit({ checks: ["canary_scenarios", "canary_collector"] });

      const verdict = rowOf(rows, "canary_scenarios");
      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("run plan");
      expect(canary).toHaveBeenCalledTimes(1);
      expect(canary).toHaveBeenCalledWith("collector", {});
      expect(rowOf(rows, "canary_collector").outcome).toBe("verified");
    });
  });
});
