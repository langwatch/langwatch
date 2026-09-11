import { AuthzApi } from "@langwatch/authz-contract";
import type { AuthzGrantsCommandDispatcher } from "@langwatch/authz-server";
import type {
  DataRetentionDirectoryReader,
  DataRetentionPlanResolver,
} from "@langwatch/data-retention-server";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import type { ProjectInfrastructure } from "@langwatch/project-server";
import { createApp, membersFrom } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TopicClusteringScheduleReader } from "@langwatch/topic-server";
import { UserApi } from "@langwatch/user-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config.ts";
import { createWorkerTenancyInfrastructure } from "../worker-tenancy-infrastructure.composition.ts";
import { installWorkerTenancy } from "../worker-tenancy.composition.ts";
import {
  tryCreateWorkerModelProviders,
  WorkerModelProviderAbsenceReport,
} from "../worker-model-provider.composition.ts";
import { createWorkerProcessDatabase } from "./support/worker-database.double.ts";

/** @see specs/worker/worker-capability-mount.feature */
const cipher = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => (value.startsWith("sealed:") ? value.slice(7) : value),
};
const runtimes: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

class RecordingModelProviderAbsence extends WorkerModelProviderAbsenceReport {
  readonly gateway: Array<"no-encryption" | "no-tenancy"> = [];
  withoutModelGateway(reason: "no-encryption" | "no-tenancy"): void {
    this.gateway.push(reason);
  }
  withoutModelTranslation(): void {}
  withoutConnectionWindows(): void {}
}

function connection() {
  const database = createWorkerProcessDatabase({
    organization: {
      findUnique: vi.fn(async () => ({
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
      })),
    },
    systemMigrationTenantState: { findUnique: vi.fn(async () => ({ status: "finalized" })) },
  });
  return PrismaConnection.create({ client: database as never, pool: {} as never });
}

/**
 * A member this composition declares but does not exercise. Any property access
 * names the member and fails, so "nothing here touches it" is enforced rather
 * than assumed - an empty object would read as `undefined` three frames later.
 */
function unusedMember<Member>(name: string): Member {
  return new Proxy({} as Member & object, {
    get(_target, property) {
      // Symbols are how a runtime inspects a value; refusing those would fail
      // the test for looking at it rather than for using it.
      if (typeof property === "symbol") return void 0;

      throw new Error(
        `The worker tenancy composition test reached ${name}.${property}. ` +
          `It is supplied because an installed module reads ${name}, not because ` +
          `this test exercises it - give it real behaviour for the path you are adding.`,
      );
    },
  }) as Member;
}

async function compose(
  options: { includeUser?: boolean; dispatcher?: AuthzGrantsCommandDispatcher } = {},
) {
  const config = resolveWorkerConfig({ CREDENTIALS_SECRET: "0".repeat(64) });
  const database = connection();
  // What the installed modules read off the process. `prisma` is the same fake
  // client the tenancy collaborators are built over, so a read through an App and
  // a read through this test see one database. `clickhouse` (data-retention) and
  // `redis` (share) are declared but never exercised here, so they refuse on any
  // access: this composition is about who is wired to whom, and a test that
  // starts querying a store should fail saying so rather than reading undefined.
  const builder = createApp({
    role: "api",
    config: {},
    members: membersFrom({
      prisma: database.client,
      clickhouse: unusedMember("clickhouse"),
      redis: unusedMember("redis"),
    }),
  });
  if (options.includeUser !== false) builder.withProvided(UserApi, createApiFixture<UserApi>());
  const infrastructure = createWorkerTenancyInfrastructure({
    connection: database,
    config,
    redis: null,
    plans: createApiFixture<PlanProvider>(),
    authzDispatcher: options.dispatcher ?? createApiFixture<AuthzGrantsCommandDispatcher>(),
    topicClustering: createApiFixture<ProjectInfrastructure["topicClustering"]>(),
    topicSchedule: createApiFixture<TopicClusteringScheduleReader>(),
    dataRetention: {
      directory: createApiFixture<DataRetentionDirectoryReader>({}, "retention directory"),
      plans: createApiFixture<DataRetentionPlanResolver>({}, "retention plans"),
      resolveClickHouseClient: null,
    },
  });
  installWorkerTenancy(builder, { ...infrastructure, encryption: cipher });
  const runtime = await builder.boot({
    role: "worker",
    config: { "data-retention": { platformDefaultRetentionDays: 28 } },
  });
  runtimes.push(runtime);

  return {
    runtime,
    database,
    tenancy: {
      projects: runtime.service(ProjectApi),
      organizations: runtime.service(OrganizationApi),
      authorization: runtime.service(AuthzApi),
    },
  };
}

describe("installWorkerTenancy", () => {
  it("provides the same tenancy Apps to all consumers", async () => {
    const { runtime, tenancy } = await compose();

    expect(tenancy.projects).toBe(runtime.service(ProjectApi));
    expect(tenancy.organizations).toBe(runtime.service(OrganizationApi));
    expect(tenancy.authorization).toBe(runtime.service(AuthzApi));
  });

  it("reads organization settings through the injected deployment cipher", async () => {
    const { tenancy } = await compose();
    const settings = await tenancy.organizations.getSettings({ organizationId: "organization-1" });

    expect(settings.s3Endpoint).toBe("https://byoc.example.com");
    expect(settings.s3AccessKeyId).toBe("AKIAEXAMPLE");
  });

  it("uses the supplied grant dispatcher and propagates its failure", async () => {
    const failure = new Error("Grant dispatcher unavailable");
    const commands = vi
      .fn<AuthzGrantsCommandDispatcher["commands"]>()
      .mockRejectedValue(failure);
    const { tenancy } = await compose({
      dispatcher: createApiFixture<AuthzGrantsCommandDispatcher>({ commands }),
    });

    await expect(
      tenancy.authorization.defineRole({
        organizationId: "organization-1",
        roleId: "role-1",
        name: "Reviewer",
        permissions: ["annotations:view"],
        kind: "custom",
        actor: { type: "user", id: "user-1" },
      }),
    ).rejects.toBe(failure);
    expect(commands).toHaveBeenCalledTimes(1);
  });

  it("refuses an incomplete tenancy graph at boot", async () => {
    await expect(compose({ includeUser: false })).rejects.toThrow(
      /no installed feature provides it/,
    );
  });
});

describe("the model gateway over the composed tenancy graph", () => {
  it("composes over the same database and tenancy Apps", async () => {
    const absence = new RecordingModelProviderAbsence();
    const { database, tenancy } = await compose();
    const providers = tryCreateWorkerModelProviders({
      config: resolveWorkerConfig({ CREDENTIALS_SECRET: "0".repeat(64) }),
      database: database.client,
      redis: null,
      encryption: cipher,
      tenancy,
      absence,
    });

    expect(providers?.modelProviders).toBeDefined();
    expect(absence.gateway).toEqual([]);
  });
});
