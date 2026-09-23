/**
 * The checkup decides from injected facts, so each scenario states the world
 * in a few lines and reads the verdict.
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { HandledError } from "@langwatch/handled-error";
import {
  CHECK_DEFINITIONS,
  CHECK_OUTCOMES,
  type CheckId,
  type CheckRow,
  explicitCheckIds,
  freeCheckIds,
} from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { type CheckupConnectView, type CheckupFacts, CheckupService } from "../checkup.service.ts";

/** What the reach probe throws for a host it could not open a connection to. */
class UnreachableHostError extends HandledError {
  constructor({ host, port }: { host: string; port: number }) {
    super("connect_unreachable", `Allow outbound HTTPS to ${host} on port ${port}.`, {
      httpStatus: 502,
      fault: "customer",
      meta: { host, port },
    });
  }
}

/** What the model provider budget throws past its limit. */
class TestBudgetUsedError extends HandledError {
  constructor({ retryAfterSeconds }: { retryAfterSeconds: number }) {
    super("model_provider_test_rate_limited", "Too many connection tests.", {
      httpStatus: 429,
      fault: "customer",
      meta: { retryAfterSeconds },
    });
  }
}

const NOW = Temporal.Instant.from("2026-09-21T10:00:00.000Z");

const CONNECTED: CheckupConnectView = {
  deployment: "on",
  licensed: true,
  entitledServices: ["instant_evals"],
  lastSyncAt: "2026-09-21T09:00:00.000Z",
  licenseHost: "https://connect.langwatch.ai",
  gatewayHost: "https://gateway.langwatch.ai",
};

function healthyDeps(overrides: Partial<CheckupFacts> = {}): CheckupFacts {
  return {
    now: () => NOW,
    install: {
      version: "2026.9.3",
      processRole: "all",
      environment: "production",
    },
    postgres: {
      ping: async () => "18.1",
      findMigrationState: async () => [{ pending: [], failed: [] }],
    },
    clickhouse: {
      configured: true,
      ping: async () => undefined,
      migrationStatus: async () =>
        "    Applied At    Migration\n    2026-09-01    -- 00001_x.sql\n",
      findAppFunctionsProvisionable: async () => [true],
    },
    redis: { target: "redis://redis:6379", ready: async () => undefined },
    gateway: async () => ({
      baseUrl: "http://gateway:5563",
      expectedControlPlaneUrl: "http://app:5560",
      health: async () => undefined,
      probeControlPlane: async () => ({
        kind: "ok",
        controlPlaneBaseUrl: "http://app:5560",
      }),
    }),
    license: async () => ({
      hasLicense: true,
      valid: true,
      planName: "Enterprise",
      expiresAt: "2027-09-21T00:00:00.000Z",
      currentMembers: 12,
      maxMembers: 50,
    }),
    connect: async () => CONNECTED,
    usageReport: {
      disabled: false,
      findIdentity: async () => [
        {
          instanceId: "4b1c",
          createdAt: "2026-08-01T00:00:00.000Z",
          lastReportAt: "2026-09-20T12:00:00.000Z",
          optionalMetricsOptOut: false,
          hostnameOptOut: false,
          startupNoticeAcknowledgedSchemaVersion: 3,
        },
      ],
      getEndpoint: async () => "https://connect.langwatch.ai/v1/stats",
    },
    reach: async () => undefined,
    storage: {
      findDestination: async () => ["S3 bucket langwatch-objects"],
      probe: async () => undefined,
    },
    email: async () => ({
      provider: "smtp",
      smtpConfigured: true,
      verifySmtp: async () => undefined,
    }),
    modelProviders: async () => [{ id: "mp_1", provider: "openai" }],
    modelProviderBudget: async () => undefined,
    testModelProvider: async () => ({ outcome: "verified" }),
    canary: async () => ({ status: 200, body: { status: 200 } }),
    ...overrides,
  };
}

/** One row's verdict, flattened so a scenario reads whichever fields its outcome carries. */
function rowOf(rows: CheckRow[], id: CheckId) {
  const row = rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`no row ${id}`);
  const { verdict } = row;
  return {
    outcome: verdict.outcome,
    detail: verdict.detail,
    fix: verdict.outcome === "verified" ? undefined : verdict.fix,
    code: verdict.outcome === "refused" ? verdict.code : undefined,
    docsPath: verdict.outcome === "verified" ? undefined : verdict.docsPath,
    meta: verdict.outcome === "refused" ? verdict.meta : undefined,
  };
}

describe("CheckupService", () => {
  describe("given every dependency answers", () => {
    /** @scenario "Every row carries one of the three verdicts" */
    it("carries one of the three verdicts on every row and loses none", async () => {
      const { rows } = await CheckupService.create(healthyDeps()).cheap();

      expect(rows.map((row) => row.id)).toEqual(
        CHECK_DEFINITIONS.map((definition) => definition.id),
      );
      for (const row of rows) {
        expect(CHECK_OUTCOMES).toContain(row.verdict.outcome);
      }
    });

    /** @scenario "The install row names the release and the process role" */
    it("names the release and the process role on the install row", async () => {
      const { rows } = await CheckupService.create(healthyDeps()).cheap();
      const verdict = rowOf(rows, "app");

      expect(verdict.outcome).toBe("verified");
      expect(verdict.detail).toContain("2026.9.3");
      expect(verdict.detail).toContain("all");
    });

    /** @scenario "The explicit checks do not run on page load" */
    it("keeps every explicit check not checked on the cheap run and opens no connection", async () => {
      const reach = vi.fn(async () => undefined);
      const canary = vi.fn(async () => ({ status: 200, body: {} }));
      const { rows } = await CheckupService.create(healthyDeps({ reach, canary })).cheap();

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
      // The license row names the day, not the timestamp the blob carries.
      expect(rowOf(rows, "license").detail).toBe(
        "Enterprise until September 21, 2027, 12 of 50 seats used.",
      );
    });

    /** @scenario "A connected install shows its last sync" */
    it("shows the last sync on a connected install", async () => {
      const { rows } = await CheckupService.create(healthyDeps()).cheap();
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
          findDestination: async () => {
            throw new Error("the project table is locked");
          },
          probe: async () => undefined,
        },
      });
      const { rows } = await CheckupService.create(deps).cheap();
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
          findMigrationState: async () => [
            {
              pending: ["20260921170000_instance_identity_startup_notice"],
              failed: [],
            },
          ],
        },
      });
      const { rows } = await CheckupService.create(deps).cheap();
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
      const { rows } = await CheckupService.create(deps).cheap();
      const verdict = rowOf(rows, "redis");

      expect(verdict.outcome).toBe("refused");
      expect(verdict.detail).toContain("redis://cache.internal:6379");
    });
  });

  describe("when no installed module answers where the gateway runs", () => {
    it("leaves the gateway row not checked and says why", async () => {
      const deps = healthyDeps({
        gateway: async () => {
          throw new Error("this process does not know where the AI Gateway runs");
        },
      });
      const { rows } = await CheckupService.create(deps).cheap();
      const verdict = rowOf(rows, "gateway");

      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("does not know where the AI Gateway runs");
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
          findAppFunctionsProvisionable: async () => [true],
        },
      });
      const { rows } = await CheckupService.create(deps).cheap();

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
        usageReport: {
          disabled: false,
          findIdentity: async () => [
            {
              instanceId: "4b1c",
              createdAt: "2026-08-01T00:00:00.000Z",
              lastReportError: "usage_report_refused_413",
              optionalMetricsOptOut: false,
              hostnameOptOut: false,
              startupNoticeAcknowledgedSchemaVersion: 3,
            },
          ],
          getEndpoint: async () => "https://connect.langwatch.ai/v1/stats",
        },
      });
      const { rows } = await CheckupService.create(deps).cheap();
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
      const deps = healthyDeps({
        usageReport: { ...healthyDeps().usageReport, disabled: true },
      });
      const { rows } = await CheckupService.create(deps).cheap();
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
          entitledServices: [],
          lastSyncAt: undefined,
        }),
      });
      const { rows } = await CheckupService.create(deps).cheap();
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
          entitledServices: [],
          lastSyncAt: undefined,
        }),
      });
      const { rows } = await CheckupService.create(deps).cheap();
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
          throw new UnreachableHostError({
            host: new URL(url).hostname,
            port: 443,
          });
        },
      });
      const { rows } = await CheckupService.create(deps).explicit({
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
      const { rows } = await CheckupService.create(healthyDeps({ reach })).explicit({
        checks: ["reach_gateway_host"],
      });

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
          throw new TestBudgetUsedError({
            retryAfterSeconds: 42,
          });
        },
        testModelProvider,
      });
      const { rows } = await CheckupService.create(deps).explicit({
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
      const { rows } = await CheckupService.create(
        healthyDeps({
          storage: { findDestination: async () => ["S3 bucket b"], probe },
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
      const { rows } = await CheckupService.create(healthyDeps({ canary })).explicit({
        checks: ["canary_scenarios", "canary_collector"],
      });

      const verdict = rowOf(rows, "canary_scenarios");
      expect(verdict.outcome).toBe("unchecked");
      expect(verdict.detail).toContain("run plan");
      expect(canary).toHaveBeenCalledTimes(1);
      expect(canary).toHaveBeenCalledWith("collector", {});
      expect(rowOf(rows, "canary_collector").outcome).toBe("verified");
    });
  });
});
