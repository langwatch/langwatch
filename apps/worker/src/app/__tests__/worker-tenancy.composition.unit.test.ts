import type { PrismaConnection } from "@langwatch/prisma-client";
import { describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  createWorkerTenancy,
  tryCreateWorkerTenancy,
  WorkerTenancyAbsenceReportPort,
} from "../worker-tenancy.composition";
import {
  tryCreateWorkerModelProviders,
  WorkerModelProviderAbsenceReportPort,
} from "../worker-model-provider.composition";

/**
 * Spec: specs/worker/worker-capability-mount.feature
 *
 * THE TENANCY GRAPH IS THE PRECONDITION EVERY MODEL PATH WAITED ON, so what
 * this suite drives is exactly the two claims a type cannot make: that the
 * three services compose from ONE client with no metric registry anywhere, and
 * that the value they compose to is the one the model gateway refuses without.
 *
 * The Prisma client is a fake because what is under test is the composition
 * rather than the query — the repositories narrow the client themselves — and
 * the one read it does answer is the settings read, because that is where this
 * process's own cipher has to appear or the graph is reading another
 * deployment's bytes.
 */

/** A reversible marker, so a settings read that skipped the cipher is visible. */
const cipher = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => (value.startsWith("sealed:") ? value.slice("sealed:".length) : value),
};

class RecordingTenancyAbsence extends WorkerTenancyAbsenceReportPort {
  grantWrites = 0;

  withoutGrantWrites(): void {
    this.grantWrites += 1;
  }
}

class RecordingModelProviderAbsence extends WorkerModelProviderAbsenceReportPort {
  readonly gateway: Array<"no-encryption" | "no-tenancy"> = [];

  withoutModelGateway(reason: "no-encryption" | "no-tenancy"): void {
    this.gateway.push(reason);
  }

  withoutModelTranslation(): void {}
  withoutConnectionWindows(): void {}
}

function settingsRow() {
  return {
    id: "organization-1",
    name: "Acme",
    slug: "acme",
    supportContact: null,
    presenceEnabled: true,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: cipher.encrypt("https://byoc.example.com"),
    s3AccessKeyId: cipher.encrypt("AKIAEXAMPLE"),
    s3Bucket: "acme-objects",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function connection() {
  return {
    client: {
      organization: { findUnique: vi.fn(async () => settingsRow()) },
      team: {},
      group: {},
      project: {},
      auditLog: { createMany: vi.fn(async () => ({ count: 0 })) },
      roleBinding: {},
      organizationAuthzMigration: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({})),
    },
  } as unknown as PrismaConnection;
}

function compose(absence?: WorkerTenancyAbsenceReportPort) {
  return createWorkerTenancy({
    connection: connection(),
    encryption: cipher,
    redis: null,
    config: resolveWorkerConfig({}),
    ...(absence ? { absence } : {}),
  });
}

describe("createWorkerTenancy", () => {
  describe("given the one Prisma client this process opened", () => {
    /** @scenario "The worker composes the tenancy graph from its own client" */
    it("composes the organization, project and permission services together", () => {
      const tenancy = compose();

      expect(Object.keys(tenancy).sort()).toEqual([
        "authorization",
        "grants",
        "organizations",
        "projects",
      ]);
    });

    /** @scenario "An organization's stored settings are read with this process's cipher" */
    it("reads an organization's stored settings through the injected cipher", async () => {
      const tenancy = compose();

      const settings = await tenancy.organizations.getSettings({
        organizationId: "organization-1",
      });

      expect(settings.s3Endpoint).toBe("https://byoc.example.com");
      expect(settings.s3AccessKeyId).toBe("AKIAEXAMPLE");
    });

    /** @scenario "The worker names the half of the tenancy graph it does not serve" */
    it("reports the absent grant write path once, at composition", () => {
      const absence = new RecordingTenancyAbsence();

      compose(absence);

      expect(absence.grantWrites).toBe(1);
    });
  });

  describe("when this process opened no client", () => {
    /** @scenario "A worker with no database composes no tenancy graph" */
    it("composes nothing", () => {
      expect(
        tryCreateWorkerTenancy({
          connection: undefined,
          encryption: cipher,
          redis: null,
          config: resolveWorkerConfig({}),
        }),
      ).toBeUndefined();
    });
  });
});

describe("the model gateway over the composed tenancy graph", () => {
  describe("given a tenancy graph and the deployment's cipher", () => {
    /** @scenario "A worker holding the tenancy graph composes the model gateway" */
    it("composes rather than reporting the missing tenancy graph", () => {
      const absence = new RecordingModelProviderAbsence();

      const providers = tryCreateWorkerModelProviders({
        config: resolveWorkerConfig({ CREDENTIALS_SECRET: "worker-secret" }),
        database: modelProviderDatabase(),
        redis: null,
        encryption: cipher,
        tenancy: compose(),
        absence,
      });

      expect(providers?.modelProviders).toBeDefined();
      expect(absence.gateway).toEqual([]);
    });
  });
});

/** The delegates the provider repositories narrow the client to, and no more. */
function modelProviderDatabase() {
  return {
    modelProvider: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    gatewayChangeEvent: { create: vi.fn(async () => undefined) },
    modelDefaultConfig: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    modelDefaultConfigScope: { findMany: vi.fn(async () => []) },
    customLLMModelCost: { findMany: vi.fn(async () => []) },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({})),
  } as unknown as Parameters<typeof tryCreateWorkerModelProviders>[0]["database"];
}
