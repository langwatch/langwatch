/**
 * The api installed as `main.ts` installs it, over memory stores (ARCHITECTURE.md §13).
 * @vitest-environment node
 * @see specs/platform/process-installation.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { RestHost } from "@langwatch/api/rest";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { serverModules } from "@langwatch/installed-server-modules";
import {
  bootInstalledProcess,
  ModuleApiToken,
  storesBackedMembers,
  withMemoryRepositories,
  type InstallableServerFeature,
} from "@langwatch/kernel";
import { processConfig } from "@langwatch/process-server";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
  type ProcessMembers,
} from "@langwatch/process-stores";
import { PromptApi } from "@langwatch/prompt-contract";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type SecretHandle,
} from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

const ROLE = "api";
/** Every value is harmless and invented: nothing here is read from `.env`. */
const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  BASE_HOST: "http://langwatch.test",
};

function unreachable<Client extends object>(name: string): Client {
  return createApiFixture<Client>({}, `${name} (no raw client over memory stores)`);
}

function overMemory(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  return module.repositoryRegistry === void 0 ? module : withMemoryRepositories(module);
}

async function bootApi() {
  const owners = processConfig(serverModules, ROLE);
  const config = parseProcessConfig({ owners, environment: SYNTHETIC_ENVIRONMENT });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: SYNTHETIC_ENVIRONMENT }).withEnv(),
  );
  refuseDoubleClaims(owners);
  const declared: readonly SecretHandle<unknown>[] = owners.flatMap((owner) =>
    "secrets" in owner ? Object.values(owner.secrets ?? {}) : [],
  );
  await resolver.preflight(declared);

  const prisma = unreachable<ProcessMembers["prisma"]>("prisma");
  const eventing = new EventSourcing({
    enabled: false,
    participation: "produce",
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const stores: Partial<ProcessMembers> = {
    logger: createTestLogger().logger,
    clock: systemClock(),
    secrets: resolvedSecrets({}),
    encryption: aesEncryption(new Uint8Array(32)),
    telemetry: unreachable<ProcessMembers["telemetry"]>("telemetry"),
    prisma,
    clickhouse: unreachable<ProcessMembers["clickhouse"]>("clickhouse"),
    objectStorage: unreachable<ProcessMembers["objectStorage"]>("objectStorage"),
    cache: unreachable<ProcessMembers["cache"]>("cache"),
    idempotency: { claim: async () => true },
    rateLimiter: { check: async () => ({ allowed: true }) },
    eventing,
    mail: unreachable<ProcessMembers["mail"]>("mail"),
  };
  const runtime = await bootInstalledProcess({
    role: ROLE,
    modules: serverModules.map(overMemory),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        ...stores,
        // The memory answer for Redis is none: every Redis-backed member has a twin.
        redis: null,
        publicBaseUrl: config.process.baseHost,
        serviceVersion: "test",
        nodeEnvironment: config.process.nodeEnvironment,
        isSaas: config.process.isSaas ?? false,
        nlpServiceUrl: config.process.nlpServiceUrl,
        nlpCodeBlockTimeoutSeconds: config.process.nlpCodeBlockTimeoutSeconds,
        adminEmails: config.process.adminEmails,
        processName: "langwatch-api",
        dataPrivacy: { directory: unreachable<object>("dataPrivacy.directory") },
        elevenLabsWebhook: void 0,
        storageResolver: void 0,
        storage: void 0,
        queue: void 0,
        content: void 0,
        gatewayInternalProtocol: {},
        connectJudge: null,
        monitor: void 0,
        langwatchQl: {
          admin: { configured: false },
          postgres: { configured: false },
          database: () => prisma,
        },
      }),
      close: async () => void 0,
    },
  });
  return { runtime, eventing };
}

const OTLP_FAMILIES: ReadonlySet<string> = new Set(["otel", "otel-logs", "otel-metrics"]);
const OTLP_TRACE_BATCH = {
  resourceSpans: [
    {
      resource: { attributes: [] },
      scopeSpans: [
        {
          scope: { name: "app.tracer" },
          spans: [
            {
              traceId: "AAECAwQFBgcICQoLDA0ODw==",
              spanId: "AAECAwQFBgc=",
              name: "call",
              kind: 1,
              startTimeUnixNano: "1700000000000000000",
              endTimeUnixNano: "1700000001000000000",
            },
          ],
        },
      ],
    },
  ],
};
const OTLP_LOG_BATCH = {
  resourceLogs: [
    {
      resource: { attributes: [] },
      scopeLogs: [
        {
          scope: { name: "app.logger" },
          logRecords: [{ timeUnixNano: "1700000000000000000", body: { stringValue: "hello" } }],
        },
      ],
    },
  ],
};
const OTLP_METRIC_BATCH = {
  resourceMetrics: [
    {
      resource: { attributes: [] },
      scopeMetrics: [
        {
          scope: { name: "app.meter" },
          metrics: [
            {
              name: "requests",
              sum: {
                aggregationTemporality: 2,
                isMonotonic: true,
                dataPoints: [{ timeUnixNano: "1700000000000000000", asInt: "12" }],
              },
            },
          ],
        },
      ],
    },
  ],
};
/** Main's canonical door and one misconfigured exporter base per signal. */
const OTLP_POSTS: readonly (readonly [string, object])[] = [
  ["/api/otel/v1/traces", OTLP_TRACE_BATCH],
  ["/api/collector/v1/traces", OTLP_TRACE_BATCH],
  ["/api/otel/v1/logs", OTLP_LOG_BATCH],
  ["/api/otel/v1/traces/v1/logs", OTLP_LOG_BATCH],
  ["/api/otel/v1/metrics", OTLP_METRIC_BATCH],
  ["/v1/metrics", OTLP_METRIC_BATCH],
];

const moduleApis = serverModules.flatMap((module) =>
  module.apiContract instanceof ModuleApiToken ? [module.apiContract] : [],
);

describe("the api process installation", () => {
  /** @scenario "Every installed module boots in the api role over memory stores" */
  it("boots every installed module and resolves each module's api through its token", async () => {
    const { runtime, eventing } = await bootApi();

    try {
      expect(moduleApis.length).toBeGreaterThan(0);
      for (const token of moduleApis) expect(runtime.service(token)).toBeDefined();
      expect(eventing.definitions.map((definition) => definition.metadata.name)).toContain(
        "trace_processing",
      );
      expect(serverModules.flatMap((module) => module.transports ?? [])).not.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The installed api serves the trace reads from coding-agent's namespace only" */
  it("serves the drawer's coding-agent reads under codingAgents, not traces", () => {
    const procedures = serverModules
      .flatMap((module) => module.transports ?? [])
      .flatMap((transport) =>
        "protocol" in transport && transport.protocol === "trpc"
          ? Object.keys(transport.contract.members).map((name) => `${transport.namespace}.${name}`)
          : [],
      );

    expect(procedures).toEqual(
      expect.arrayContaining(["codingAgents.session", "codingAgents.transcript"]),
    );
    expect(procedures).not.toContain("traces.codingAgentSession");
    expect(procedures).not.toContain("traces.codingAgentTranscript");
  });

  /** @scenario "Two process installations share no state" */
  it("keeps what one installation writes out of another", async () => {
    const first = await bootApi();
    const second = await bootApi();

    try {
      await first.runtime
        .service(PromptApi)
        .createTag({ organizationId: "organization-1", name: "canary" });

      await expect(
        second.runtime.service(PromptApi).listTags({ organizationId: "organization-1" }),
      ).resolves.toEqual([]);
    } finally {
      await Promise.all([first.runtime.stop(), second.runtime.stop()]);
    }
  });

  /** @scenario "The api answers the CLI device flow routes main serves" */
  it("answers every CLI device-flow route from the installed auth module", async () => {
    const { runtime } = await bootApi();

    try {
      const closed = {
        authenticate: () => {
          throw new Error("the device flow authenticates its caller itself.");
        },
      };
      const host = RestHost.create({
        identities: {
          project: closed,
          organization: closed,
          apiKey: closed,
          scimToken: closed,
          "instance-admin": closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
      });
      const hono = host.app;
      const deviceFlow = serverModules
        .filter((module) => module.apiContract === AuthApi)
        .flatMap((module) => module.transports ?? [])
        .find((transport) => transport.protocol === "rest" && transport.namespace === "auth-cli");
      if (!deviceFlow) throw new Error("no installed module declares the auth-cli family");
      host.mount(deviceFlow.router(), () => runtime.service(AuthApi));
      const post = (path: string, body: object) =>
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const started = await hono.fetch(post("/api/auth/cli/device-code", {}));
      const statuses = await Promise.all(
        [
          post("/api/auth/cli/exchange", { device_code: "never-minted" }),
          post("/api/auth/cli/refresh", { refresh_token: "never-minted" }),
          new Request("http://api.test/api/auth/cli/lookup?user_code=NOPE-NOPE"),
          post("/api/auth/cli/approve", { user_code: "NOPE-NOPE", organization_id: "org-1" }),
          post("/api/auth/cli/deny", { user_code: "NOPE-NOPE" }),
          post("/api/auth/cli/logout", { refresh_token: "never-minted" }),
        ].map(async (request) => [
          new URL(request.url).pathname,
          (await hono.fetch(request)).status,
        ]),
      );

      expect({ status: started.status, body: await started.json() }).toMatchObject({
        status: 200,
        body: { verification_uri: "http://langwatch.test/cli/auth" },
      });
      expect(Object.fromEntries(statuses)).toEqual({
        "/api/auth/cli/exchange": 408,
        "/api/auth/cli/refresh": 401,
        "/api/auth/cli/lookup": 401,
        "/api/auth/cli/approve": 401,
        "/api/auth/cli/deny": 401,
        "/api/auth/cli/logout": 200,
      });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The api process serves every OTLP signal at its own module's door" */
  it("answers every OTLP signal from its owner's door, canonically and under an alias", async () => {
    const { runtime } = await bootApi();

    try {
      const closed = {
        authenticate: () => {
          throw new Error("the OTLP doors resolve their key themselves.");
        },
      };
      const host = RestHost.create({
        identities: {
          project: closed,
          organization: closed,
          apiKey: closed,
          scimToken: closed,
          "instance-admin": closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
      });
      const families = new Map<string, string>();
      for (const module of serverModules) {
        const token = module.apiContract;
        if (!(token instanceof ModuleApiToken)) continue;
        for (const transport of module.transports ?? []) {
          const namespace = transport.namespace ?? "";
          if (transport.protocol !== "rest" || !OTLP_FAMILIES.has(namespace)) continue;
          families.set(namespace, module.name);
          host.mount(transport.router(), () => runtime.service(token));
        }
      }
      const post = (path: string, body: object) =>
        host.app.fetch(
          new Request(`http://api.test${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
      const answers = await Promise.all(
        OTLP_POSTS.map(async ([path, body]) => {
          const response = await post(path, body);
          return [path, response.status, Object.keys(await response.json())];
        }),
      );

      expect(Object.fromEntries(families)).toEqual({
        otel: "trace",
        "otel-logs": "log",
        "otel-metrics": "metric",
      });
      expect(answers).toEqual(OTLP_POSTS.map(([path]) => [path, 401, ["message"]]));
      expect((await post("/elsewhere/v1/metrics", OTLP_METRIC_BATCH)).status).toBe(404);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "the composed api process keeps its audit entries in the installed audit-log module" */
  it("records into the installed audit-log module and reads the entry back", async () => {
    const { runtime } = await bootApi();

    try {
      const audit = runtime.service(AuditLogApi);
      await audit.record({
        userId: "user-1",
        projectId: "project-1",
        action: "prompts.update",
        args: { configId: "prompt-1" },
      });

      await expect(
        audit.listEntityHistory({
          projectId: "project-1",
          actionPrefix: "prompts.",
          entityId: "prompt-1",
          argumentNames: ["configId"],
          limit: 10,
        }),
      ).resolves.toHaveLength(1);
    } finally {
      await runtime.stop();
    }
  });
});
