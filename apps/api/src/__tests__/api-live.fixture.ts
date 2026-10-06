/**
 * The api booted as `main.ts` boots it, wholly live over the local Postgres, Redis and a migrated
 * ClickHouse (ARCHITECTURE.md §7: one store tier per process), served on a free loopback port.
 * Every secret is a synthetic test value: nothing here is read from `.env`.
 */
import { createServer } from "node:net";

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { processConfig, Server } from "@langwatch/process";

import { processModules } from "../process-modules.generated.ts";
import {
  deleteSeededTenantRows,
  startMigratedClickHouseEndpoint,
} from "./monitor-performance.fixture.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const clickHouseUrl = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;

/** Whether the local Postgres, Redis and ClickHouse a live boot needs are named. */
export const liveStoresConfigured = Boolean(databaseUrl && redisUrl && clickHouseUrl);

/** The connection string of the test database the live api reads and writes. */
export function liveDatabaseUrl(): string {
  if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is not set");
  return databaseUrl;
}

/** The deployment settings every live boot shares; each is a synthetic test value. */
export const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  NEXTAUTH_SECRET: "synthetic-nextauth-secret-synthetic",
  API_KEY_PEPPER: "synthetic-api-key-pepper",
  LW_VIRTUAL_KEY_PEPPER: "synthetic-virtual-key-pepper",
  CREDENTIALS_SECRET: "0".repeat(64),
};

/** A port the kernel just handed out, free again for the api to bind. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no free port was bound");
  return address.port;
}

/**
 * Boots and serves the api. `environment` adds or overrides process settings (`IS_SAAS`, ...).
 * `baseUrl` is where it serves, also its own public address. One test process mounts a module's
 * WebSocket declaration once, so a second api boots only after the first one closes.
 */
export async function bootLiveApi({
  environment = {},
  withWorker = false,
}: { environment?: Readonly<Record<string, string>>; withWorker?: boolean } = {}) {
  if (!databaseUrl || !redisUrl) throw new Error("the live api needs the test Postgres and Redis");
  const [clickHouse, port] = await Promise.all([startMigratedClickHouseEndpoint(), freePort()]);
  const baseUrl = `http://127.0.0.1:${port}`;
  const processEnvironment = {
    ...SYNTHETIC_ENVIRONMENT,
    BASE_HOST: baseUrl,
    NEXTAUTH_URL: baseUrl,
    API_PORT: String(port),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    CLICKHOUSE_URL: clickHouse.url,
    ...(process.env.REDIS_DB_INDEX ? { REDIS_DB_INDEX: process.env.REDIS_DB_INDEX } : {}),
    ...environment,
  };
  const worker = withWorker ? await bootWorkerBeside(processEnvironment) : null;
  const server = await Server.create("langwatch-api")
    .withEnvironment(processEnvironment)
    .withConfig(processConfig(processModules))
    .withProcessOwnership(false)
    .withSecrets((_config, secrets) => secrets.withEnv())
    .start();
  const application = await server
    .container("api")
    .exposeTransports((transports) => transports.trpc().rest().browserBundle(false))
    .boot();
  await server.serve(application);

  return {
    application,
    baseUrl,
    /** Sends a request to the served api; `path` is absolute (`/api/...`). */
    fetch: (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init),
    close: async () => {
      await server.close();
      await worker?.close();
    },
  };
}

/**
 * The worker role over the same stores, as the local launcher hosts it beside the api: the
 * ledgers' folds (grants, identity) are the worker's, and an api without one never confirms them.
 */
async function bootWorkerBeside(environment: Readonly<Record<string, string>>) {
  const server = await Server.create("langwatch-worker")
    .withEnvironment({
      ...environment,
      VOICE_TUNNEL: "false",
      VOICE_WS_PORT: "0",
      WORKER_METRICS_PORT: "0",
    })
    .withConfig(processConfig(processModules, "worker"))
    .withProcessOwnership(false)
    .withSecrets((_config, secrets) => secrets.withEnv())
    .start();
  await server.run(await server.container("worker").boot());

  return server;
}

export type LiveApi = Awaited<ReturnType<typeof bootLiveApi>>;

/** A Postgres connection of the suite's own, for the rows it seeds, reads back and removes. */
export function openLivePrisma({ label }: { label: string }) {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger(`langwatch:test:${label}`),
  }).connect(
    PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
  );
  return { prisma: connection.client as PrismaClient, close: () => connection.closeOnce() };
}

export type TrpcAnswer = {
  status: number;
  /** The procedure's output, absent when it refused. */
  data: unknown;
  /** The refusal's tRPC code, absent when it answered. */
  code: string | undefined;
  body: string;
};

/**
 * Calls one procedure on the live root as a browser does: a query is a GET with its input in
 * the URL, a mutation a POST of the input. `session` is a person {@link signUpSession} signed in.
 */
export async function callTrpc({
  api,
  path,
  kind,
  input,
  session,
  headers = {},
}: {
  api: LiveApi;
  path: string;
  kind: "query" | "mutation";
  input?: unknown;
  session?: LiveSession;
  headers?: Readonly<Record<string, string>>;
}): Promise<TrpcAnswer> {
  const base = { ...session?.headers, ...headers };
  const response =
    kind === "query"
      ? await api.fetch(
          `/api/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
          { headers: base },
        )
      : await api.fetch(`/api/trpc/${path}`, {
          method: "POST",
          headers: { ...base, "content-type": "application/json" },
          body: JSON.stringify(input ?? {}),
        });
  const body = await response.text();
  const parsed = (() => {
    try {
      return JSON.parse(body) as {
        result?: { data?: unknown };
        error?: { data?: { code?: string } };
      };
    } catch {
      return {};
    }
  })();
  return {
    status: response.status,
    data: parsed.result?.data,
    code: parsed.error?.data?.code,
    body,
  };
}

export type LiveSession = {
  userId: string;
  email: string;
  /** What a browser holding the session sends on every request. */
  headers: Readonly<Record<string, string>>;
};

const SIGN_UP_PASSWORD = "Synthetic-Pass-2026!x";
let signUps = 0;

/**
 * A person signed in the product's own way over the live api: the sign-up form's verification
 * step (an installation with no mailer answers the unconfirmed proof), the registration it
 * spends, then the password sign-in whose cookie is the session. Nothing is written by hand.
 */
export async function signUpSession({
  api,
  label,
}: {
  api: LiveApi;
  label: string;
}): Promise<LiveSession> {
  signUps += 1;
  const email = `${label}-${Date.now().toString(36)}-${signUps}@session-fixture.example`;
  const browser = {
    origin: api.baseUrl,
    "x-forwarded-for": `198.51.100.${(Date.now() + signUps) % 250}`,
  };
  const asked = await callTrpc({
    api,
    path: "auth.requestSignUpVerification",
    kind: "mutation",
    input: { email },
    headers: browser,
  });
  const addressProof = (asked.data as { addressProof?: string } | undefined)?.addressProof;
  if (!addressProof) throw new Error(`sign-up verification gave no proof: ${asked.body}`);
  const registered = await callTrpc({
    api,
    path: "user.register",
    kind: "mutation",
    input: { email, password: SIGN_UP_PASSWORD, addressProof },
    headers: browser,
  });
  const userId = (registered.data as { id?: string } | undefined)?.id;
  if (!userId) throw new Error(`registration created no account: ${registered.body}`);
  const signedIn = await api.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { ...browser, "content-type": "application/json" },
    body: JSON.stringify({ email, password: SIGN_UP_PASSWORD }),
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  if (!signedIn.ok || !cookie) {
    throw new Error(`sign-in opened no session: ${signedIn.status} ${await signedIn.text()}`);
  }

  return { userId, email, headers: { ...browser, cookie } };
}

/** Removes the accounts {@link signUpSession} made and the organizations they founded. */
export async function removeSignedUpRows({
  prisma,
  userIds,
  organizationIds,
}: {
  prisma: PrismaClient;
  userIds: readonly string[];
  organizationIds: readonly string[];
}): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { organizationId: { in: [...organizationIds] } },
    select: { id: true },
  });
  const projects = await prisma.project.findMany({
    where: { teamId: { in: teams.map(({ id }) => id) } },
    select: { id: true },
  });
  const where = { organizationId: { in: [...organizationIds] } };
  const inProjects = { projectId: { in: projects.map(({ id }) => id) } };
  await prisma.annotationQueueItem.deleteMany({ where: inProjects });
  await prisma.annotationQueueMembers.deleteMany({ where: { annotationQueue: inProjects } });
  await prisma.annotationQueueScores.deleteMany({ where: { annotationQueue: inProjects } });
  await prisma.annotationQueue.deleteMany({ where: inProjects });
  await prisma.pinnedTrace.deleteMany({ where: inProjects });
  await prisma.shareLink.deleteMany({ where: inProjects });
  await prisma.dataPrivacyPolicy.deleteMany({ where });
  await prisma.grant.deleteMany({ where });
  await prisma.roleBinding.deleteMany({ where });
  await prisma.project.deleteMany({ where: { teamId: { in: teams.map(({ id }) => id) } } });
  await prisma.team.deleteMany({ where });
  await prisma.organizationUser.deleteMany({ where });
  for (const userId of userIds) {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.identifier.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.organization.deleteMany({ where: { id: { in: [...organizationIds] } } });
}

/** An organization with one team and one project, written straight to the live Postgres. */
export async function seedOrganization({ prisma, label }: { prisma: PrismaClient; label: string }) {
  const ns = `${label}-${generate("test").toString()}`.toLowerCase();
  const organization = await prisma.organization.create({
    data: { name: `Seeded ${label}`, slug: `--test-org-${ns}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `Seeded ${label} team`,
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  const project = await seedProject({ prisma, teamId: team.id, label: ns });

  return { organization, team, project };
}

/** One project on a team, with a unique slug and key. */
export function seedProject({
  prisma,
  teamId,
  label,
}: {
  prisma: PrismaClient;
  teamId: string;
  label: string;
}) {
  const ns = `${label}-${generate("test").toString()}`.toLowerCase();
  return prisma.project.create({
    data: {
      name: `Seeded ${label} project`,
      slug: `--test-project-${ns}`,
      apiKey: `--test-key-${ns}`,
      teamId,
      language: "python",
      framework: "openai",
    },
  });
}

/**
 * A trace the live ClickHouse answers to: one `trace_summaries` row, which is what trace
 * storage is asked about. The worker folds it from spans in a deployment; here it is written.
 */
export async function seedTraceSummary({
  tenantId,
  traceId,
}: {
  tenantId: string;
  traceId: string;
}): Promise<void> {
  const { client } = await startMigratedClickHouseEndpoint();
  const occurredAt = new Date();
  await client.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `projection-${generate("test").toString()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        Attributes: {},
        OccurredAt: occurredAt,
        CreatedAt: occurredAt,
        UpdatedAt: occurredAt,
        ComputedIOSchemaVersion: "",
        ComputedInput: "in",
        ComputedOutput: "out",
        TimeToFirstTokenMs: 50,
        TimeToLastTokenMs: 200,
        TotalDurationMs: 200,
        TokensPerSecond: 100,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: ["gpt-5-mini"],
        TotalCost: 0.01,
        TokensEstimated: false,
        TotalPromptTokenCount: 100,
        TotalCompletionTokenCount: 50,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** Removes the trace rows {@link seedTraceSummary} wrote for these tenants. */
export async function removeSeededTraces({
  tenantIds,
}: {
  tenantIds: readonly string[];
}): Promise<void> {
  const { client } = await startMigratedClickHouseEndpoint();
  for (const tenantId of tenantIds) await deleteSeededTenantRows({ client, tenantId });
}
