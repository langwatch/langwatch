/**
 * The api installed as `main.ts` installs it, over memory stores (ARCHITECTURE.md §13).
 * @vitest-environment node
 * @see specs/platform/process-installation.feature
 */
import { RestHost } from "@langwatch/api/rest";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { serverModules } from "@langwatch/installed-server-modules";
import { ModuleApiToken } from "@langwatch/kernel";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import { bootApi } from "./api-installation.fixture.ts";

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
      .flatMap((transport) => {
        if (transport.protocol !== "trpc" || !("contract" in transport)) return [];
        const { contract } = transport;
        if (typeof contract !== "object" || contract === null || !("members" in contract))
          return [];
        const { members } = contract;
        if (typeof members !== "object" || members === null) return [];
        return Object.keys(members).map((name) => `${transport.namespace}.${name}`);
      });

    expect(procedures).toEqual(
      expect.arrayContaining(["codingAgents.session", "codingAgents.transcript"]),
    );
    expect(procedures).not.toContain("traces.codingAgentSession");
    expect(procedures).not.toContain("traces.codingAgentTranscript");
  });

  /** @scenario "Talk to it reads its ElevenLabs key through model-provider" */
  it("answers gateway's voice credential read from model-provider's stored keys", async () => {
    const { runtime } = await bootApi();

    try {
      const { organization } = await runtime
        .service(OrganizationApi)
        .createForProvisioning({ name: "Voice" });
      const provider = await runtime.service(ModelProviderApi).upsertUnattributed({
        organizationId: organization.id,
        provider: "elevenlabs",
        enabled: true,
        customKeys: { ELEVENLABS_API_KEY: "xi-invented" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organization.id }],
      });

      await expect(
        runtime.service(GatewayApi).getElevenLabsApiCredential({ modelProviderId: provider.id }),
      ).resolves.toEqual({ apiKey: "xi-invented", baseUrl: "https://api.elevenlabs.io" });
      await expect(
        runtime.service(GatewayApi).getTwilioCredential({ modelProviderId: provider.id }),
      ).rejects.toMatchObject({ code: "voice_key_missing" });
    } finally {
      await runtime.stop();
    }
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

  /** @scenario "The api process removes an automation's report schedule through the pipeline's senders" */
  it("schedules and removes a report on the api role, where no pipeline is hosted", async () => {
    const { runtime } = await bootApi();

    try {
      const automations = runtime.service(AutomationApi);
      const report = { projectId: "project-1", triggerId: "trigger-1" };
      await expect(
        automations.syncReportSchedule({ ...report, cron: "0 9 * * 1", timezone: "UTC" }),
      ).resolves.toBeUndefined();
      await expect(automations.removeReportSchedule(report)).resolves.toBeUndefined();
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
