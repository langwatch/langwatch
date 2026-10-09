/** @vitest-environment node */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  identifierProviderFor,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import {
  deriveIdentifierId,
  LinkProposalGuards,
  MfaGuards,
} from "@langwatch/identity-server";
import type { Redis } from "ioredis";
import IORedis from "ioredis";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App, globalForApp } from "~/server/app-layer/app";
import { PrismaAuthzAuditTrailRepository } from "~/server/app-layer/authz/repositories/authz-audit-trail.prisma.repository";
import { PrismaAuthzGrantsWriteRepository } from "~/server/app-layer/authz/repositories/authz-grants-write.prisma.repository";
import { prisma } from "~/server/db";
import { EventSourcing } from "~/server/event-sourcing/eventSourcing";
import { createAuthzGrantsPipeline } from "~/server/event-sourcing/pipelines/authz-grants/pipeline";
import { createIdentityPipeline } from "~/server/event-sourcing/pipelines/identity/pipeline";
import { EventStoreMemory } from "~/server/event-sourcing/stores/eventStoreMemory";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../migration-name";
import { EventLogIdentityRepository } from "../repositories/identity-event-log.repository";
import { PrismaMfaEnrollmentRepository } from "../repositories/mfa-enrollment.prisma.repository";
import { PrismaMfaEnrollmentProjectionRepository } from "../repositories/mfa-enrollment-projection.prisma.repository";
import {
  identityGuards,
  identityProjectionStore,
  databaseHooks as productionDatabaseHooks,
} from "../runtime";
import {
  createSamlFixture,
  createSigningIdentity,
} from "./saml-signin.fixture";

let idp: Awaited<ReturnType<typeof createSigningIdentity>>;
let fixture: Awaited<ReturnType<typeof createSamlFixture>> | undefined;
let eventSourcing: EventSourcing | undefined;
let redis: Redis | undefined;
let redisProcess: ChildProcessWithoutNullStreams | undefined;

async function startEphemeralRedis(): Promise<URL> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  if (address === null || typeof address === "string") {
    probe.close();
    throw new Error("could not reserve a local Redis port for the SAML proof");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });

  redisProcess = spawn(
    "redis-server",
    [
      "--bind",
      "127.0.0.1",
      "--port",
      String(port),
      "--save",
      "",
      "--appendonly",
      "no",
    ],
    { stdio: "pipe" },
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      finish(false, new Error("ephemeral Redis did not become ready"));
    }, 5_000);
    const onOutput = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Ready to accept connections")) {
        finish(true);
      }
    };
    const onExit = (code: number | null) => {
      finish(
        false,
        new Error(`ephemeral Redis exited before readiness (${code})`),
      );
    };
    const onError = (error: Error) => finish(false, error);
    const cleanup = () => {
      clearTimeout(timer);
      redisProcess?.stdout.off("data", onOutput);
      redisProcess?.stderr.off("data", onOutput);
      redisProcess?.off("exit", onExit);
      redisProcess?.off("error", onError);
    };
    const finish = (success: boolean, error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (success) resolve();
      else reject(error);
    };
    redisProcess?.stdout.on("data", onOutput);
    redisProcess?.stderr.on("data", onOutput);
    redisProcess?.once("exit", onExit);
    redisProcess?.once("error", onError);
  });
  return new URL(`redis://127.0.0.1:${port}`);
}

async function redisUrlForProof(): Promise<URL> {
  if (process.env.CI) {
    const configuredUrl = process.env.CI_REDIS_URL;
    if (!configuredUrl) {
      throw new Error("CI_REDIS_URL is required for the fresh SAML proof");
    }
    return new URL(configuredUrl);
  }
  return startEphemeralRedis();
}

beforeAll(async () => {
  idp = await createSigningIdentity();
});

beforeEach(async () => {
  const redisUrl = await redisUrlForProof();
  redis = new IORedis(redisUrl.toString(), {
    maxRetriesPerRequest: null,
  });
  eventSourcing = EventSourcing.createWithStores({
    eventStore: new EventStoreMemory(),
    redis,
    processRole: "worker",
  });
  const authzPipeline = eventSourcing.register(
    createAuthzGrantsPipeline({
      authzGrantsWriteStore: new PrismaAuthzGrantsWriteRepository(prisma),
      authzAuditTrailStore: new PrismaAuthzAuditTrailRepository(prisma),
    }),
  );
  const pipeline = eventSourcing.register(
    createIdentityPipeline({
      identityProjectionStore: identityProjectionStore(),
      identityGuards: identityGuards(),
      mfaProjectionStore: new PrismaMfaEnrollmentProjectionRepository(prisma),
      mfaGuards: new MfaGuards(new PrismaMfaEnrollmentRepository(prisma)),
      linkProposalGuards: new LinkProposalGuards({
        proposals: new EventLogIdentityRepository(),
      }),
    }),
  );
  await authzPipeline.service.waitUntilReady();
  await pipeline.service.waitUntilReady();
  const appHandle = Object.assign(Object.create(App.prototype) as App, {
    _eventSourcing: eventSourcing,
    redis,
    notifications: {
      sendSlackSignupEvent: async () => void 0,
    },
  });
  globalForApp.__langwatch_app = appHandle;
  fixture = await createSamlFixture(idp, {
    databaseHooks: productionDatabaseHooks(),
    arrivalPolicy: "admit",
  });
});

afterEach(async () => {
  const currentEventSourcing = eventSourcing;
  eventSourcing = void 0;
  try {
    // Stop and drain the projection before deleting its fixture rows. A
    // queued admission must not land after cleanup and recreate a Grant.
    await currentEventSourcing?.close();
  } finally {
    globalForApp.__langwatch_app = null;
    try {
      await fixture?.cleanup();
    } finally {
      fixture = void 0;
      try {
        await redis?.quit();
      } finally {
        redis = void 0;
        const child = redisProcess;
        redisProcess = void 0;
        if (child && child.exitCode === null) {
          await new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
          });
        }
      }
    }
  }
});

async function waitForFinalized(
  userId: string,
  organizationId: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const state = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
        },
      },
      select: { status: true },
    });
    if (state?.status === "finalized") return;
    if (Date.now() >= deadline) {
      const [identifierCount, accountCount, membershipCount] =
        await Promise.all([
          prisma.identifier.count({ where: { userId } }),
          prisma.account.count({ where: { userId } }),
          prisma.organizationUser.count({
            where: { userId, organizationId },
          }),
        ]);
      throw new Error(
        `fresh SAML user did not finalize identity adoption (status=${state?.status ?? "missing"}, identifiers=${identifierCount}, accounts=${accountCount}, memberships=${membershipCount})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("a fresh signed SAML user", () => {
  /** @scenario "A fresh SAML callback adopts identity before its first session is used" */
  it("runs the production arrival hook and finalizes one real identity", async () => {
    if (!fixture) throw new Error("SAML fixture was not initialized");
    const email = `fresh@${fixture.domain}`;

    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(
      await prisma.account.count({ where: { provider: fixture.providerId } }),
    ).toBe(0);
    expect(await prisma.identifier.count({ where: { value: email } })).toBe(0);

    const first = await fixture.signIn(email);
    const userId = first.session?.user.id;
    expect(userId).toBeTruthy();
    if (!userId)
      throw new Error("fresh SAML callback did not create a session");

    await waitForFinalized(userId, fixture.organizationId);

    const account = await prisma.account.findFirstOrThrow({
      where: { userId, provider: fixture.providerId },
    });
    const identifierId = deriveIdentifierId({
      userId,
      provider: identifierProviderFor(account.provider),
      providerAccountId: account.providerAccountId,
      normalizedValue: normalizeIdentifierValue(email),
      occurredAtMs: account.createdAt.getTime(),
    });
    expect(
      await prisma.identifier.findUnique({ where: { id: identifierId } }),
    ).toMatchObject({ userId, providerId: fixture.providerId });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ).toMatchObject({ email, emailVerified: false });
    expect(
      await prisma.session.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { identifierId: true },
      }),
    ).toEqual({ identifierId });

    const repeated = await fixture.signIn(email);
    expect(repeated.session?.user.id).toBe(userId);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    expect(await prisma.identifier.count({ where: { userId } })).toBe(2);
    expect(
      await prisma.organizationUser.count({
        where: { userId, organizationId: fixture.organizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.systemMigrationTenantState.count({
        where: {
          tenantId: userId,
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        },
      }),
    ).toBe(1);
  });
});
