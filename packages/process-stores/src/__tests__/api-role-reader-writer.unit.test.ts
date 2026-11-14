/**
 * @vitest-environment node
 * The api's stores over the reader and the writer credentials alone (ADR-202 Decided 3, 12, 14):
 * its eventing checks no aggregate index, so it sends no statement that skips the tenant check,
 * and its inserts leave on the writer.
 * @see specs/clickhouse/app-reader-identity.feature · specs/clickhouse/app-writer-identity.feature
 * @see specs/clickhouse/api-credentials.feature
 */
import { createServer, type Server } from "node:http";

import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryRequest,
  type SkippedTenantCheck,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import type * as Observability from "@langwatch/observability";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { storesOwner, type StoresConfig } from "../config-owner.ts";
import type { EventingConfig, ProcessConfig } from "../config.ts";
import { buildProcessStores } from "../create-members.ts";
import { openStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const warnings = vi.hoisted(() => [] as { fields: unknown; message: string }[]);

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) =>
      name === "langwatch:clickhouse:identities"
        ? { warn: (fields: unknown, message: string) => warnings.push({ fields, message }) }
        : actual.createLogger(name),
  };
});

const PRODUCER: EventingConfig = {
  store: { kind: "producer-only" },
  consumersEnabled: false,
  executionTarget: "web",
  processManagerMode: "producer-only",
};

const CONSUMER: EventingConfig = {
  store: { kind: "event-log", defaultRetentionDays: 30 },
  consumersEnabled: true,
  executionTarget: "worker",
  processManagerMode: "run",
};

/** A role's stores over a client holding the reader and the writer, recording what each is sent. */
function storesOver({ eventing }: { eventing: EventingConfig }) {
  const skipped: SkippedTenantCheck[] = [];
  const sent: QueryRequest[] = [];
  const written: InsertRequest[] = [];
  const refuse = () => Promise.reject(new Error("the reader runs reads only"));
  const refuseRead = () => Promise.reject(new Error("the writer runs inserts only"));
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard({ onUnscoped: (skip) => skipped.push(skip) }),
    readerDriver: {
      execute: <Row>(request: QueryRequest) => {
        sent.push(request);
        return Promise.resolve({ rows: [] as Row[] });
      },
      command: refuse,
      insert: refuse,
    },
    writerDriver: {
      execute: refuseRead,
      command: refuseRead,
      insert: (request: InsertRequest) => {
        written.push(request);
        return Promise.resolve();
      },
    },
  });
  const config: ProcessConfig = {
    processName: "api-role-reader-only-test",
    encryptionKey: "0".repeat(64),
    secrets: {},
    rateLimit: { requests: 60, seconds: 60 },
    clickhouse: {
      readerUrl: "http://reader.invalid:8123",
      writerUrl: "http://writer.invalid:8123",
    },
    eventing,
  };
  const stores = buildProcessStores({
    config,
    members: { clickhouse, prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }) },
  });
  return { stores, skipped, sent, written, clickhouse };
}

const DSPY_INSERT: InsertRequest = {
  tenantId: "project_1",
  table: "dspy_steps",
  rows: [{ TenantId: "project_1" }],
};

describe("given a role's stores over the reader and the writer credentials alone", () => {
  describe("when the api's producer eventing is built", () => {
    /** @scenario "The api's eventing checks no event-log index, so it sends no skip-check statement" */
    it("sends no statement that skips the tenant check", async () => {
      const consumer = storesOver({ eventing: CONSUMER });
      const producer = storesOver({ eventing: PRODUCER });
      try {
        consumer.stores.members.read("eventing");
        producer.stores.members.read("eventing");

        // The draining role's index check is what the producer would have sent.
        await vi.waitFor(() => expect(consumer.skipped.length).toBeGreaterThan(0));
        expect(producer.skipped).toEqual([]);
        expect(producer.sent).toEqual([]);
      } finally {
        await producer.stores.members.close();
        await consumer.stores.members.close();
      }
    });
  });

  describe("when the api's producer eventing is built and an insert is sent", () => {
    /** @scenario "The api's stores boot with the reader and the writer credentials alone" */
    it("skips no tenant check and sends the insert on the writer", async () => {
      const producer = storesOver({ eventing: PRODUCER });
      try {
        producer.stores.members.read("eventing");
        await producer.clickhouse.insert(DSPY_INSERT);

        expect(producer.skipped).toEqual([]);
        expect(producer.sent).toEqual([]);
        expect(producer.written).toEqual([DSPY_INSERT]);
      } finally {
        await producer.stores.members.close();
      }
    });
  });
});

const storesConfig: StoresConfig = {
  defaultRetentionDays: 30,
  shutdownDrainTimeoutMs: undefined,
  queueConcurrency: undefined,
  queueTenantCap: undefined,
  queueGlobalBudget: undefined,
  clickhouseStatementLaneReserveShare: undefined,
  clickhousePasswordFile: undefined,
  clickhouseShadowSampleRate: 0,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  redis: { dbIndex: undefined },
  objectStorage: {
    backend: "file",
    localRoot: "/tmp/langwatch-api-credentials-test",
    s3: { bucket: undefined, endpoint: undefined, region: undefined },
    azure: {
      authMode: undefined,
      accountName: undefined,
      container: undefined,
      endpoint: undefined,
      authorityHost: undefined,
      tokenAudience: undefined,
      allowInsecureTokenEndpointForTests: undefined,
      identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
    },
  },
};

/** The tenant directory reads Postgres lazily; every statement here names its organisation. */
const DATABASE = { DATABASE_URL: "postgresql://langwatch@database.invalid:5432/langwatch" };
const SECRET = "s3cret-value";

/** One fake ClickHouse answering every user; it records who sent what, never a password. */
let server: Server;
let base: string;
let received: { user: string; insert: boolean }[] = [];

function userOf(authorization: string | undefined, header: string | string[] | undefined) {
  if (authorization?.startsWith("Basic ")) {
    return Buffer.from(authorization.slice(6), "base64").toString("utf8").split(":")[0] ?? "";
  }
  return typeof header === "string" ? header : "";
}

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const query = new URL(request.url ?? "/", "http://fake").searchParams.get("query") ?? "";
      received.push({
        user: userOf(request.headers.authorization, request.headers["x-clickhouse-user"]),
        insert: /^\s*INSERT\b/i.test(query),
      });
      response.setHeader("Content-Type", "application/x-ndjson");
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port was bound.");
  base = `127.0.0.1:${address.port}/langwatch`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received = [];
  warnings.length = 0;
});

const urlAs = (user: string) => `http://${user}:${SECRET}@${base}`;

async function withStores<T>(
  options: { role: "api" | "worker" | "tasks"; environment: Record<string, string> },
  use: (members: Awaited<ReturnType<typeof openStores>>["members"]) => Promise<T>,
): Promise<T> {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { ...DATABASE, ...options.environment } }).withEnv(),
  );
  const { members } = await openStores({
    name: "api-credentials-test",
    role: options.role,
    config: storesConfig,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines:
      options.role === "worker"
        ? PipelineParticipation.consumer()
        : PipelineParticipation.producer(),
    production: false,
  });
  try {
    members.read("clickhouse");
    return await use(members);
  } finally {
    await members.close();
  }
}

const READER_AND_WRITER = () => ({
  CLICKHOUSE_READER_URL: urlAs("reader"),
  CLICKHOUSE_READER_URL__eu__org_1: urlAs("reader_eu"),
  CLICKHOUSE_WRITER_URL: urlAs("writer"),
  CLICKHOUSE_WRITER_URL__eu__org_1: urlAs("writer_eu"),
});

const readFor = (organizationId: string) => ({
  tenantId: "project_1",
  organizationId,
  sql: "SELECT TenantId FROM dspy_steps WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_1" },
  table: "dspy_steps",
  SKIP_COLD_SCAN_CHECK: true as const,
});

const insertFor = (organizationId: string) => ({ ...DSPY_INSERT, organizationId });

const credentialWarnings = () => warnings.filter(({ message }) => message.includes("system"));

describe("given the api's stores opened over the reader and the writer alone", () => {
  describe("when it reads and inserts on the shared server and on an organisation's own", () => {
    /** @scenario "An api on the reader and the writer alone serves both route families" */
    it("sends each read as that server's reader and each insert as its writer, none as the system", async () => {
      await withStores({ role: "api", environment: READER_AND_WRITER() }, async (members) => {
        const clickhouse = members.read("clickhouse");
        await clickhouse.query(readFor("org_shared"));
        await clickhouse.query(readFor("org_1"));
        await clickhouse.insert(insertFor("org_shared"));
        await clickhouse.insert(insertFor("org_1"));
      });

      expect(received).toEqual([
        { user: "reader", insert: false },
        { user: "reader_eu", insert: false },
        { user: "writer", insert: true },
        { user: "writer_eu", insert: true },
      ]);
      expect(credentialWarnings()).toEqual([]);
    });
  });
});

describe("given an api given the system credential beside the reader and the writer", () => {
  describe("when its stores open", () => {
    /** @scenario "An api given the system credential beside the reader and the writer warns by variable name" */
    it("boots and warns once, naming CLICKHOUSE_URL and never its value", async () => {
      await withStores(
        { role: "api", environment: { ...READER_AND_WRITER(), CLICKHOUSE_URL: urlAs("system") } },
        () => Promise.resolve(),
      );

      expect(credentialWarnings()).toHaveLength(1);
      expect(credentialWarnings()[0]?.fields).toEqual({ variables: ["CLICKHOUSE_URL"] });
      expect(JSON.stringify(warnings)).not.toContain(SECRET);
    });
  });

  describe("when it also holds system routes, a malformed one and the password file", () => {
    /** @scenario "The warning names every system route and the password file, never their values" */
    it("names each variable and carries no URL, user or password", async () => {
      await withStores(
        {
          role: "api",
          environment: {
            ...READER_AND_WRITER(),
            CLICKHOUSE_URL__eu__org_1: urlAs("system_eu"),
            CLICKHOUSE_URL__broken__org_2: "not a url",
          },
        },
        () => Promise.resolve(),
      );

      const [warning] = credentialWarnings();
      expect(warning?.fields).toEqual({
        variables: ["CLICKHOUSE_URL__eu__org_1", "CLICKHOUSE_URL__broken__org_2"],
      });
      const logged = JSON.stringify(warnings);
      for (const leaked of [SECRET, "system_eu", base, "not a url"]) {
        expect(logged).not.toContain(leaked);
      }
    });
  });
});

describe("given a worker and a tasks process holding all three credentials", () => {
  describe("when their stores open", () => {
    /** @scenario "A worker or tasks process holding all three credentials does not warn" */
    it("logs no api credential warning for either", async () => {
      const environment = { ...READER_AND_WRITER(), CLICKHOUSE_URL: urlAs("system") };
      await withStores({ role: "worker", environment }, () => Promise.resolve());
      await withStores({ role: "tasks", environment }, () => Promise.resolve());

      expect(credentialWarnings()).toEqual([]);
    });
  });
});

describe("given an api with the system credential and the reader but no writer", () => {
  describe("when its stores open", () => {
    /** @scenario "An api without both the reader and the writer keeps today's behaviour and does not warn" */
    it("logs no api credential warning", async () => {
      await withStores(
        {
          role: "api",
          environment: { CLICKHOUSE_URL: urlAs("system"), CLICKHOUSE_READER_URL: urlAs("reader") },
        },
        () => Promise.resolve(),
      );

      expect(credentialWarnings()).toEqual([]);
    });
  });
});
