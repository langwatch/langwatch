/**
 * @vitest-environment node
 *
 * What a finished tRPC call leaves behind: what the audit trail is allowed to
 * keep of the arguments, how loudly the request log records the call, and which
 * trace the span continues.
 */
import { HandledError } from "@langwatch/handled-error";
import { context as otelContext, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { TRPCError } from "@trpc/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callerTraceContext,
  deriveAuditTarget,
  handleTrpcCallLogging,
  recordTrpcCall,
  redactAuditArgs,
  resetSlowCallThrottle,
} from "../audit.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Redaction. The audit trail stores a mutation's input verbatim, and
// `customKeys` carries provider API keys exactly as the customer typed them.
// ─────────────────────────────────────────────────────────────────────────────

describe("redactAuditArgs", () => {
  describe("given input carrying provider credentials", () => {
    describe("when it is recorded in the audit trail", () => {
      /** @scenario "A credential is never persisted to the audit trail" */
      it("replaces the values but keeps which credentials were set", () => {
        const redacted = redactAuditArgs({
          input: {
            organizationId: "org-1",
            provider: "gemini",
            customKeys: {
              GEMINI_API_KEY: "AIzaSyTheCustomersRealKey",
            },
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("AIzaSyTheCustomersRealKey");
        expect(redacted.customKeys).toEqual({
          GEMINI_API_KEY: "[redacted]",
        });
        // The rest of the record is what makes it worth keeping.
        expect(redacted.provider).toBe("gemini");
        expect(redacted.organizationId).toBe("org-1");
      });

      it("redacts every credential, not only the first", () => {
        const redacted = redactAuditArgs({
          input: {
            customKeys: {
              AZURE_OPENAI_API_KEY: "secret-one",
              AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
            },
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("secret-one");
        expect(JSON.stringify(redacted)).not.toContain("example.openai");
      });

      // `extraHeaders` rides the same `modelProvider.update` mutation as
      // `customKeys` and is where an `Authorization: Bearer …` is typed, so
      // redacting only the latter leaves the secret in the table anyway.
      /** @scenario "A credential typed as a header is never persisted either" */
      it("redacts a header's value while keeping its name", () => {
        const redacted = redactAuditArgs({
          input: {
            extraHeaders: [
              { key: "Authorization", value: "Bearer sk-the-real-token" },
              { key: "X-Tenant", value: "acme" },
            ],
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("sk-the-real-token");
        expect(redacted.extraHeaders).toEqual([
          { key: "Authorization", value: "[redacted]" },
          { key: "X-Tenant", value: "[redacted]" },
        ]);
      });

      // A header that does not carry the `{ key, value }` shape the schema
      // declares still carries whatever was typed into it.
      /** @scenario "A credential typed as a header is never persisted either" */
      it("replaces a header entry of any other shape", () => {
        const redacted = redactAuditArgs({
          input: {
            extraHeaders: [
              "Authorization: Bearer sk-a-bare-string",
              { raw: "Bearer sk-in-another-field" },
              { key: 7, value: "sk-under-a-numeric-name" },
            ],
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("sk-");
        expect(redacted.extraHeaders).toEqual(["[redacted]", "[redacted]", "[redacted]"]);
      });

      /** A passthrough object, so its contents cannot be assumed harmless. */
      it("redacts providerConfig values", () => {
        const redacted = redactAuditArgs({
          input: {
            providerConfig: { serviceAccountJson: '{"private_key":"pk"}' },
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("private_key");
        expect(redacted.providerConfig).toEqual({
          serviceAccountJson: "[redacted]",
        });
      });

      // No schema produces this shape. The point is the failure direction:
      // an unexpected shape must not be the one that gets through.
      it("redacts a credential field arriving in an unexpected shape", () => {
        const redacted = redactAuditArgs({
          input: { customKeys: ["sk-off-schema-but-still-a-secret"] },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("off-schema");
      });

      it("redacts every credential-carrying field on one write", () => {
        const redacted = redactAuditArgs({
          input: {
            provider: "custom",
            customKeys: { CUSTOM_API_KEY: "key-secret" },
            extraHeaders: [{ key: "Authorization", value: "header-secret" }],
            providerConfig: { token: "config-secret" },
          },
        }) as Record<string, unknown>;

        const serialized = JSON.stringify(redacted);
        expect(serialized).not.toContain("key-secret");
        expect(serialized).not.toContain("header-secret");
        expect(serialized).not.toContain("config-secret");
        expect(redacted.provider).toBe("custom");
      });
    });
  });

  describe("given a mutation that carries a key in a named field", () => {
    describe("when it is recorded", () => {
      /** @scenario "The licence signing private key is never persisted to the audit trail" */
      it("keeps no part of the licence signing private key", () => {
        const redacted = redactAuditArgs({
          input: {
            organizationId: "org-1",
            privateKey:
              "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANTheRealSigningKey\n-----END PRIVATE KEY-----",
            organizationName: "Acme",
            email: "ops@acme.example",
            planType: "ENTERPRISE",
            plan: { maxMembers: 50, canPublish: true, usageUnit: "traces" },
          },
          action: "license.generate",
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealSigningKey");
        expect(JSON.stringify(redacted)).not.toContain("BEGIN PRIVATE KEY");
        expect(redacted.privateKey).toBe("[redacted]");
        expect(redacted.organizationName).toBe("Acme");
        expect(redacted.planType).toBe("ENTERPRISE");
      });

      /** @scenario "An uploaded licence key is never persisted to the audit trail" */
      it("keeps no part of an uploaded licence key", () => {
        const redacted = redactAuditArgs({
          input: { organizationId: "org-1", licenseKey: "eyJhbGciOiJSUzI1NiJ9.TheRealBearer" },
          action: "license.upload",
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealBearer");
        expect(redacted.organizationId).toBe("org-1");
      });

      /** @scenario "A credential is never persisted to the audit trail" */
      /** @scenario "A secret typed into a scalar field never reaches the audit trail" */
      it.each(["secrets.create", "secrets.update"])("redacts a secret value on %s", (action) => {
        const redacted = redactAuditArgs({
          input: { projectId: "proj-1", name: "STRIPE_KEY", value: "sk-live-TheRealSecret" },
          action,
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealSecret");
        expect(redacted.name).toBe("STRIPE_KEY");
      });

      // The per-action list can never be complete: the next mutation that
      // takes a key writes plaintext until someone remembers to add it.
      /** @scenario "A credential-named field is redacted on a mutation nobody listed" */
      it.each([
        "privateKey",
        "apiKey",
        "sharedSecret",
        "clientSecret",
        "accessToken",
        "password",
        "signingKey",
        "licenseKey",
        "slackWebhook",
        "webhookUrl",
        "credentials",
        "authorization",
      ])("redacts %s on an action with no rule of its own", (field) => {
        const redacted = redactAuditArgs({
          input: { projectId: "proj-1", [field]: "TheRealSecret" },
          action: "someFeature.update",
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealSecret");
        expect(redacted.projectId).toBe("proj-1");
      });

      /** @scenario "A credential nested inside an input object is redacted too" */
      it("redacts a credential nested inside an object and inside a list", () => {
        const redacted = redactAuditArgs({
          input: {
            projectId: "proj-1",
            destinationConfig: {
              destinations: [
                { type: "webhook", url: "https://siem.example", sharedSecret: "TheRealSecret" },
              ],
            },
          },
          action: "anomalyRules.create",
        });

        expect(JSON.stringify(redacted)).not.toContain("TheRealSecret");
        expect(JSON.stringify(redacted)).toContain("https://siem.example");
      });
    });
  });

  describe("given input with no credentials in it", () => {
    describe("when it is recorded", () => {
      it("passes the arguments through untouched", () => {
        const input = { projectId: "proj-1", name: "Gemini" };

        expect(redactAuditArgs({ input })).toBe(input);
      });

      it.each([undefined, null, "a string", 42])("leaves %s alone", (input) => {
        expect(redactAuditArgs({ input })).toBe(input);
      });

      it("leaves a non-object customKeys alone", () => {
        const input = { customKeys: null };

        expect(redactAuditArgs({ input })).toBe(input);
      });

      it("leaves a non-array extraHeaders alone", () => {
        const input = { extraHeaders: null };

        expect(redactAuditArgs({ input })).toBe(input);
      });

      // Plural counts are numbers on nearly every model write; a name rule
      // that ate them would redact the record instead of protecting it.
      /** @scenario "A token count is not mistaken for a credential" */
      it("leaves token counts alone", () => {
        const input = { maxTokens: 4096, promptTokens: 12, completionTokens: 30 };

        expect(redactAuditArgs({ input, action: "prompts.update" })).toBe(input);
      });
    });
  });

  describe("given a run started with parameter values", () => {
    describe("when the action is one that can carry a secret parameter", () => {
      /** @scenario "Audit log entries never record a secret value" */
      it.each(["suites.run", "scenarios.run"])(
        "keeps the names and drops every value on %s",
        (action) => {
          const redacted = redactAuditArgs({
            input: {
              projectId: "proj-1",
              parameters: { api_token: "tok-live-1", region: "eu-central" },
            },
            action,
          }) as Record<string, unknown>;

          expect(JSON.stringify(redacted)).not.toContain("tok-live-1");
          expect(redacted.parameters).toEqual({
            api_token: "[redacted]",
            region: "[redacted]",
          });
          expect(redacted.projectId).toBe("proj-1");
        },
      );

      /** @scenario "Audit log entries never record a secret value" */
      it("redacts the values typed into the http test button", () => {
        const redacted = redactAuditArgs({
          input: {
            projectId: "proj-1",
            url: "https://api.example.com/chat",
            templateVariables: { token: "tok-live-1" },
          },
          action: "httpProxy.execute",
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("tok-live-1");
        expect(redacted.templateVariables).toEqual({ token: "[redacted]" });
        expect(redacted.url).toBe("https://api.example.com/chat");
      });
    });

    describe("when the action is any other one", () => {
      // `parameters` is an ordinary word: a code agent's config carries one,
      // and its contents are the agent's own code, not a credential.
      it("leaves a parameters field on an unrelated action alone", () => {
        const input = { parameters: { region: "eu-central" } };

        expect(redactAuditArgs({ input, action: "agents.update" })).toBe(input);
        expect(redactAuditArgs({ input })).toBe(input);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The Target column: what a mutation wrote, and what kind of thing that is.
// ─────────────────────────────────────────────────────────────────────────────

/** Every namespace whose mutations write a resource, and the kind each writes. */
const NAMESPACE_KINDS: [string, string][] = [
  ["gatewayBudgets.create", "budget"],
  ["virtualKeys.create", "virtual_key"],
  ["personalVirtualKeys.create", "virtual_key"],
  ["gatewayProviders.update", "provider_binding"],
  ["cacheRules.create", "cache_rule"],
  ["ingestionSources.create", "ingestion_source"],
  ["anomalyRules.create", "anomaly_rule"],
  ["routingPolicy.update", "routing_policy"],
  ["aiTools.create", "ai_tool_entry"],
  ["aiToolsCatalog.create", "ai_tool_entry"],
  ["organization.update", "organization"],
  ["project.create", "project"],
  ["team.create", "team"],
  ["user.update", "user"],
  ["analytics.savedWorkbenchCharts.create", "saved_workbench_chart"],
  ["apiKey.create", "api_key"],
  ["github.disconnect", "github_connection"],
  ["license.upload", "license"],
  ["llmModelCost.createOrUpdate", "llm_model_cost"],
  ["modelProvider.codexSignInPoll", "model_provider"],
  ["scimToken.generate", "scim_token"],
  ["subscription.create", "subscription"],
  ["webhookEndpoints.create", "webhook_endpoint"],
];

describe("deriveAuditTarget", () => {
  describe("given a mutation that wrote a resource", () => {
    it.each(NAMESPACE_KINDS)("records what %s wrote as a %s", (path, kind) => {
      expect(deriveAuditTarget(path, { id: "res_1" })).toEqual({
        targetKind: kind,
        targetId: "res_1",
      });
    });

    describe("when the resource is wrapped in the answer", () => {
      it("takes the id from one level in", () => {
        expect(deriveAuditTarget("modelProvider.update", { provider: { id: "mp_1" } })).toEqual({
          targetKind: "model_provider",
          targetId: "mp_1",
        });
      });
    });
  });

  describe("given a namespace assembled from two features", () => {
    // `analytics.*` is charted reads and the workbench, `analytics.savedWorkbenchCharts.*`
    // the dashboard's saved charts: the sub-router is the honest name, the root has none.
    it("names the sub-router that wrote, and nothing for the rest of the namespace", () => {
      expect(deriveAuditTarget("analytics.lwql.query", { rows: [] })).toEqual({});
    });
  });

  describe("given a mutation that wrote no resource of its own", () => {
    it("records no kind for a translation or a blocked-limit report", () => {
      expect(deriveAuditTarget("translate.translate", { translation: "hallo" })).toEqual({});
      expect(deriveAuditTarget("licenseEnforcement.reportLimitBlocked", undefined)).toEqual({});
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The request-log record for one finished call.
// ─────────────────────────────────────────────────────────────────────────────

function createMockLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const baseArgs = {
  path: "suites.getAll",
  type: "query",
  duration: 42,
  userAgent: "test-agent",
  statusCode: 200,
};

describe("handleTrpcCallLogging", () => {
  describe("given a successful result", () => {
    describe("when result.ok is true", () => {
      it("logs at info level", () => {
        const log = createMockLog();
        const capture = vi.fn();

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: true },
          log,
          capture,
        });

        expect(log.info).toHaveBeenCalledWith(
          expect.objectContaining({ path: "suites.getAll", duration: 42 }),
          "trpc call",
        );
        expect(log.warn).not.toHaveBeenCalled();
        expect(log.error).not.toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a failed result", () => {
    describe("when error is INTERNAL_SERVER_ERROR", () => {
      it("derives 500 from TRPCError code, logs at error level, and captures", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "boom",
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "suites.getAll",
            error,
            statusCode: 500,
          }),
          "trpc call",
        );
        expect(capture).toHaveBeenCalledWith(error);
        expect(log.info).not.toHaveBeenCalled();
      });
    });

    describe("when error is BAD_REQUEST", () => {
      it("derives 400 from TRPCError code and logs at warn level", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new TRPCError({
          code: "BAD_REQUEST",
          message: "bad request",
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ error, statusCode: 400 }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
        expect(log.error).not.toHaveBeenCalled();
      });
    });

    describe("when error is NOT_FOUND", () => {
      it("derives 404 from TRPCError code and logs at info level", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new TRPCError({
          code: "NOT_FOUND",
          message: "not found",
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.info).toHaveBeenCalledWith(
          expect.objectContaining({ error, statusCode: 404 }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
        expect(log.warn).not.toHaveBeenCalled();
      });
    });

    describe("when error is a plain Error (not TRPCError)", () => {
      it("defaults to 500 behavior", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new Error("unexpected");

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: 500 }),
          "trpc call",
        );
        expect(capture).toHaveBeenCalledWith(error);
      });
    });

    describe("when the cause is a HandledError", () => {
      class CustomerBoom extends HandledError {
        constructor() {
          super("customer_boom", "fixable by the caller", {
            httpStatus: 500,
            fault: "customer",
          });
        }
      }

      class PlatformBoom extends HandledError {
        constructor() {
          super("platform_boom", "our infra is down", {
            httpStatus: 503,
            fault: "platform",
          });
        }
      }

      class ProviderBoom extends HandledError {
        constructor() {
          super("provider_unreachable", "the provider never answered", {
            httpStatus: 502,
            fault: "provider",
          });
        }
      }

      /** @scenario "Log level follows fault attribution, not handled-ness" */
      it("logs customer-fault errors at warn, even for 5xx, and does not capture", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const cause = new CustomerBoom();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 500,
            handledErrorCode: "customer_boom",
            handledErrorFault: "customer",
          }),
          "trpc call",
        );
        expect(log.error).not.toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
      });

      /** @scenario "Log level follows fault attribution, not handled-ness" */
      it("logs platform-fault errors at error but still does not capture", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const cause = new PlatformBoom();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            // 503, not the 500 the envelope carries: tRPC v10 has no code for
            // it, so the code-derived status understates what happened.
            statusCode: 503,
            handledErrorCode: "platform_boom",
            handledErrorFault: "platform",
          }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
      });

      /**
       * An upstream that never answered is not our error budget. tRPC v10
       * cannot express 502, so without preferring the handled status every
       * customer typo in a base URL is recorded as a LangWatch 500.
       */
      it("records a provider fault at its own status, not the envelope's 500", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const cause = new ProviderBoom();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 502,
            handledErrorCode: "provider_unreachable",
            handledErrorFault: "provider",
          }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
      });
    });
  });
});

/**
 * specs/observability/slow-work-warnings.feature, the API-call half. This half covers the calls
 * whose slow work is not a Postgres query: a ClickHouse read, a provider call, serialization.
 * The procedure record is the one place that always carries the full duration.
 */
describe("a call that succeeds slowly", () => {
  const BUDGET_MS = 3000;
  const THROTTLE_MS = 60_000;

  beforeEach(() => {
    resetSlowCallThrottle();
  });

  describe("given a budget of 3000 milliseconds", () => {
    describe("when a call succeeds inside the budget", () => {
      /** @scenario "A call inside the budget stays at info" */
      it("stays at info level", () => {
        const log = createMockLog();

        handleTrpcCallLogging({
          ...baseArgs,
          duration: 42,
          result: { ok: true },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: BUDGET_MS,
          now: 0,
        });

        expect(log.info).toHaveBeenCalledTimes(1);
        expect(log.warn).not.toHaveBeenCalled();
      });
    });

    describe("when a call succeeds over the budget", () => {
      /** @scenario "A call over the budget is raised to warning" */
      it("raises the record to warning, naming the path, duration and budget", () => {
        const log = createMockLog();

        handleTrpcCallLogging({
          ...baseArgs,
          path: "limits.getUsage",
          duration: 9000,
          result: { ok: true },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: BUDGET_MS,
          now: 0,
        });

        expect(log.info).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "limits.getUsage",
            duration: 9000,
            budgetMs: BUDGET_MS,
          }),
          "trpc call",
        );
      });
    });

    describe("when a slow call also failed", () => {
      /** @scenario "A failed slow call keeps the level its failure earned" */
      it("keeps the level its failure earned rather than the slow warning", () => {
        const log = createMockLog();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "boom",
        });

        handleTrpcCallLogging({
          ...baseArgs,
          duration: 9000,
          result: { ok: false, error },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: BUDGET_MS,
          now: 0,
        });

        expect(log.error).toHaveBeenCalledTimes(1);
        expect(log.warn).not.toHaveBeenCalled();
      });
    });

    describe("when the budget is set to zero", () => {
      /** @scenario "A call inside the budget stays at info" */
      it("turns the warning off entirely", () => {
        const log = createMockLog();

        handleTrpcCallLogging({
          ...baseArgs,
          duration: 60_000,
          result: { ok: true },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: 0,
          now: 0,
        });

        expect(log.info).toHaveBeenCalledTimes(1);
        expect(log.warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a procedure that is slow on every call", () => {
    const callSlowly = ({
      log,
      times,
      now,
    }: {
      log: ReturnType<typeof createMockLog>;
      times: number;
      now: number;
    }) => {
      for (let i = 0; i < times; i++) {
        handleTrpcCallLogging({
          ...baseArgs,
          path: "limits.getUsage",
          duration: 9000,
          result: { ok: true },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: BUDGET_MS,
          now,
        });
      }
    };

    describe("when it runs 50 times inside one throttle interval", () => {
      /** @scenario "A call over the budget is raised to warning" */
      /** @scenario "A slow call is raised without burying the log" */
      it("warns once and leaves the rest at info, so no record is lost", () => {
        const log = createMockLog();

        callSlowly({ log, times: 50, now: 0 });

        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.info).toHaveBeenCalledTimes(49);
      });
    });

    describe("when the interval elapses and it is slow again", () => {
      /** @scenario "A call over the budget is raised to warning" */
      /** @scenario "A slow call is raised without burying the log" */
      it("reports how many calls the throttle suppressed", () => {
        const log = createMockLog();
        callSlowly({ log, times: 50, now: 0 });

        callSlowly({ log, times: 1, now: THROTTLE_MS });

        expect(log.warn).toHaveBeenCalledTimes(2);
        expect(log.warn.mock.calls[1]![0]).toMatchObject({
          suppressedSincePrevious: 49,
        });
      });
    });
  });

  describe("given a silenced path", () => {
    describe("when a presence heartbeat succeeds slowly", () => {
      /** @scenario "A silenced path stays silent even when slow" */
      it("logs nothing at all, warning included", () => {
        const log = createMockLog();

        recordTrpcCall({
          ...baseArgs,
          path: "presence.heartbeat",
          duration: 9000,
          result: { ok: true },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: BUDGET_MS,
          now: 0,
        });

        expect(log.warn).not.toHaveBeenCalled();
        expect(log.info).not.toHaveBeenCalled();
        expect(log.error).not.toHaveBeenCalled();
      });

      /**
       * Without this the test above passes on a `recordTrpcCall` that logs
       * nothing for anyone.
       */
      it("still warns for an ordinary path that is equally slow", () => {
        const log = createMockLog();

        recordTrpcCall({
          ...baseArgs,
          path: "scenarios.getById",
          duration: 9000,
          result: { ok: true },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: BUDGET_MS,
          now: 0,
        });

        expect(log.warn).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a heartbeat fails", () => {
      /** @scenario "A silenced path still reports its failures" */
      it("reports it, because the volume that earns the silence is happy-path volume", () => {
        const log = createMockLog();

        recordTrpcCall({
          ...baseArgs,
          path: "presence.heartbeat",
          result: {
            ok: false,
            error: new TRPCError({ code: "INTERNAL_SERVER_ERROR" }),
          },
          log,
          capture: vi.fn(),
          slowCallBudgetMs: BUDGET_MS,
          now: 0,
        });

        expect(log.error).toHaveBeenCalledTimes(1);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The trace a tRPC span continues, so work the browser starts and the server
// work it triggers land in one trace instead of two.
//
// Binds `A call started in the browser continues on the server` and `Calls over
// the realtime transports still correlate` in
// specs/observability/browser-rum-trace-correlation.feature. See ADR-058.
// ─────────────────────────────────────────────────────────────────────────────

const REMOTE_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const REMOTE_SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${REMOTE_TRACE_ID}-${REMOTE_SPAN_ID}-01`;

const spanContextOf = (context: ReturnType<typeof callerTraceContext>) =>
  trace.getSpanContext(context);

describe("callerTraceContext", () => {
  // `propagation.extract` delegates to the globally registered propagator, and
  // the global default is a no-op. Without this the extraction assertions would
  // pass vacuously - every context would come back empty for the wrong reason.
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  describe("given a caller that sent trace context", () => {
    describe("when the call arrives over a request-per-call transport", () => {
      /** @scenario A call started in the browser continues on the server */
      it("adopts the caller's trace and span as the parent", () => {
        const context = callerTraceContext({
          req: { headers: { traceparent: TRACEPARENT } },
          type: "query",
        });

        expect(spanContextOf(context)).toMatchObject({
          traceId: REMOTE_TRACE_ID,
          spanId: REMOTE_SPAN_ID,
          isRemote: true,
        });
      });

      it("adopts it for mutations too", () => {
        const context = callerTraceContext({
          req: { headers: { traceparent: TRACEPARENT } },
          type: "mutation",
        });

        expect(spanContextOf(context)?.traceId).toBe(REMOTE_TRACE_ID);
      });
    });

    describe("when the call is a subscription", () => {
      /**
       * A subscription rides a long-lived connection, so `req` is the handshake
       * request. Adopting it would parent every later message to whatever trace
       * happened to open the socket.
       */
      it("ignores the handshake trace rather than reusing it forever", () => {
        const context = callerTraceContext({
          req: { headers: { traceparent: TRACEPARENT } },
          type: "subscription",
        });

        expect(spanContextOf(context)).toBeUndefined();
      });
    });
  });

  describe("given a caller that sent no trace context", () => {
    it("starts a fresh trace when the header is absent", () => {
      const context = callerTraceContext({
        req: { headers: { "user-agent": "vitest" } },
        type: "query",
      });

      expect(spanContextOf(context)).toBeUndefined();
    });

    it("starts a fresh trace when the traceparent is malformed", () => {
      const context = callerTraceContext({
        req: { headers: { traceparent: "not-a-traceparent" } },
        type: "query",
      });

      expect(spanContextOf(context)).toBeUndefined();
    });
  });

  describe("given a call with no request at all", () => {
    /**
     * A context built by tests and SSG helpers has no req/res, so this path has
     * to stay non-throwing.
     */
    it("survives a missing req", () => {
      expect(() => callerTraceContext({ req: void 0, type: "query" })).not.toThrow();
    });

    it("survives a req with no headers", () => {
      expect(spanContextOf(callerTraceContext({ req: {}, type: "query" }))).toBeUndefined();
    });
  });

  describe("given the HTTP layer has already opened a span for this request", () => {
    /**
     * The `/api` router extracts the same `traceparent` and opens the server
     * span that is executing this call. Extracting again would parent the
     * procedure to the browser instead, leaving the HTTP span a childless
     * sibling of the work it is actually running.
     */
    it("keeps the local span as the parent instead of re-extracting", () => {
      otelContext.setGlobalContextManager(new StackContextManager().enable());
      const provider = new BasicTracerProvider();
      const httpSpan = provider.getTracer("test").startSpan("POST /api");

      try {
        otelContext.with(trace.setSpan(otelContext.active(), httpSpan), () => {
          const parent = callerTraceContext({
            req: { headers: { traceparent: TRACEPARENT } },
            type: "query",
          });

          expect(spanContextOf(parent)?.spanId).toBe(httpSpan.spanContext().spanId);
          expect(spanContextOf(parent)?.spanId).not.toBe(REMOTE_SPAN_ID);
        });
      } finally {
        httpSpan.end();
        otelContext.disable();
      }
    });
  });
});
