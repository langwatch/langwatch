/**
 * The Go data plane's door into this process, driven over real HTTP.
 *
 * The HMAC gate is the whole of this surface's authentication — there is no
 * session, no API key and no RBAC behind it — so what it does with a signature
 * IS the security boundary, and it is pinned here against the REAL family
 * built by `composeApiGatewayInternalRest` through the REAL security chain.
 * The fakes are at the ports: a changes feed, a virtual-key service and a
 * store, none of which a refused request may reach.
 *
 * The refusal bodies are asserted verbatim, and deliberately so. The Go
 * gateway's own client branches on `error.code`, and its status monitor treats
 * a 200 on `/health` as proof that the shared secret matches — so a body that
 * drifted here would look like a working deployment while every virtual-key
 * resolve was being refused.
 *
 * @see apps/api/src/app/api-gateway-internal-rest.composition.ts
 * @see packages/features/gateway/server/src/transport/api-rest/gateway-internal.api.ts
 */
// @vitest-environment node
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { AppRestSecurity } from "@langwatch/api/rest";
import { buildGatewayCanonicalString, computeGatewaySignature } from "@langwatch/gateway-server";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { describe, expect, it, vi } from "vitest";

import { ApiRestSecurity } from "../../api-rest.security";
import { composeApiGatewayInternalRest } from "../api-gateway-internal-rest.composition";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";

const INTERNAL_SECRET = "shared-hmac-secret";
const JWT_SECRET = "gateway-jwt-signing-secret";
/** 32 bytes of hex, which is what the stored-secret cipher refuses anything else for. */
const CREDENTIALS_SECRET = "b".repeat(64);
const ORGANIZATION_ID = "organization-1";

/**
 * The change-event rows, as the row store under the real repository.
 *
 * The double sits at the DATABASE rather than at the port, so the repository
 * the composition builds — the one production runs — is what answers this
 * request: the `revision > since` predicate, the ascending order and the
 * bigint-to-string rendering on the wire are all really exercised.
 */
function testChangeEventRows() {
  const findMany = vi.fn(async () => [
    {
      revision: 42n,
      kind: "VK_CREATED" as const,
      virtualKeyId: "vk_1",
      budgetId: null,
      modelProviderId: null,
      projectId: null,
    },
  ]);
  return {
    findMany,
    findFirst: vi.fn(async () => ({ revision: 42n })),
  };
}

/**
 * The spend pipeline's senders, as the producer registration publishes them.
 *
 * The doubles sit where `composeApiGatewaySpendPipeline` hands the family its
 * registration's dispatchers, so everything between the signed request and the
 * queue — the batch schema, the per-record mapping, the rating seam and the
 * batched-send preference — is really exercised.
 */
function testSpendCommandSenders() {
  const send = () => vi.fn(async (_payload: unknown) => undefined);
  return {
    admitSpend: { send: send() },
    confirmSpend: {
      send: send(),
      sendBatch: vi.fn(async (_payloads: unknown[]) => undefined),
    },
    failSpend: { send: send() },
  };
}

/**
 * The guardrail port's collaborators: the guardrail row lookup, the monitor
 * directory and the evaluator runtime — the same three the composition
 * refuses the whole route without.
 */
function testGuardrails(options?: {
  guardrails?: Array<{ id: string; evaluatorId: string; failureMode: string }>;
  monitors?: Array<{ id: string; evaluatorId: string; checkType: string; parameters: unknown }>;
  runEvaluator?: ReturnType<typeof vi.fn>;
}) {
  const findMany = vi.fn(async () => options?.guardrails ?? []);
  const listEnabledGuardrailMonitors = vi.fn(async () => options?.monitors ?? []);
  const runEvaluator =
    options?.runEvaluator ?? vi.fn(async () => ({ status: "processed" as const, passed: true }));
  return { findMany, listEnabledGuardrailMonitors, runEvaluator };
}

/** The family, built the way the process builds it. */
function composeFamily(options: {
  changes: ReturnType<typeof testChangeEventRows>;
  spendCommands?: ReturnType<typeof testSpendCommandSenders>;
  guardrails?: ReturnType<typeof testGuardrails>;
}) {
  const prisma = {
    gatewayChangeEvent: options.changes,
    ...(options.guardrails ? { gatewayGuardrail: { findMany: options.guardrails.findMany } } : {}),
  } as unknown as PrismaClient;

  const security: AppRestSecurity = ApiRestSecurity.create({
    apiKeys: {} as unknown as ApiKeyService,
    authz: {} as unknown as AuthzService,
    organizations: {} as unknown as OrganizationService,
    observability: ApiRestObservabilityComposition.create(),
  });

  const app = composeApiGatewayInternalRest({
    security,
    prisma,
    gateway: {
      app: {} as never,
      virtualKeys: {} as never,
      budgetSpend: undefined,
      virtualKeySpend: undefined,
      spendEvents: undefined,
      budgetDecisions: {} as never,
    },
    projects: {} as unknown as ProjectService,
    internalSecret: INTERNAL_SECRET,
    jwtSecret: JWT_SECRET,
    encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
    ...(options.spendCommands ? { spendCommands: options.spendCommands } : {}),
    ...(options.guardrails
      ? {
          monitors: {
            listEnabledGuardrailMonitors: options.guardrails.listEnabledGuardrailMonitors,
          } as unknown as MonitorService,
          runEvaluator: options.guardrails.runEvaluator,
        }
      : {}),
  });
  if (!app) throw new Error("the composition refused a process that holds both halves");
  return app;
}

/**
 * One drained outcome, in the wire shape the gateway's spooler posts.
 *
 * `virtual_key_id` is deliberately absent: an outcome that names no key needs
 * no control-plane attribution join, so the record reaches the senders without
 * a database read. The quantities are what the rating seam prices.
 */
function spendCommandBatchBody(): string {
  return JSON.stringify({
    records: [
      {
        command: "confirmSpend",
        payload: {
          gateway_request_id: "gwreq_1",
          occurred_at: 1_760_000_000_000,
          project_id: "project-1",
          model: "openai/gpt-5-mini",
          model_provider_id: "provider-1",
          duration_ms: 120,
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
        pod_id: "gw-test-1",
        pod_seq: 7,
      },
    ],
  });
}

/** A request signed exactly the way the Go data plane signs one. */
function signedRequest(input: { method: string; path: string; body?: string }): Request {
  const body = input.body ?? "";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeGatewaySignature(
    INTERNAL_SECRET,
    buildGatewayCanonicalString({
      method: input.method,
      // The canonical string covers the PATH only — the query string is not
      // signed, which is what the data plane does and what the verifier reads.
      path: new URL(`http://api.test${input.path}`).pathname,
      timestamp,
      body,
    }),
  );
  return new Request(`http://api.test${input.path}`, {
    method: input.method,
    headers: {
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
      "X-LangWatch-Gateway-Node": "gw-test-1",
    },
    ...(input.method === "GET" ? {} : { body }),
  });
}

describe("the gateway internal control plane", () => {
  describe("given a request signed with the shared internal secret", () => {
    it("passes the HMAC gate and reaches the change feed", async () => {
      const changes = testChangeEventRows();
      const app = composeFamily({ changes });

      const response = await app.request(
        signedRequest({
          method: "GET",
          path: `/api/internal/gateway/changes?organization_id=${ORGANIZATION_ID}&since=0&timeout_s=1`,
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        current_revision: "42",
        changes: [
          {
            kind: "VK_CREATED",
            virtual_key_id: "vk_1",
            budget_id: null,
            model_provider_id: null,
            project_id: null,
            revision: "42",
          },
        ],
      });
      expect(changes.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORGANIZATION_ID, revision: { gt: 0n } },
        orderBy: { revision: "asc" },
        take: 500,
        select: {
          revision: true,
          kind: true,
          virtualKeyId: true,
          budgetId: true,
          modelProviderId: true,
          projectId: true,
        },
      });
    });

    /** @scenario "control plane answers the gateway's signed health probe" */
    it("answers the connectivity probe the data plane's status monitor polls", async () => {
      const app = composeFamily({ changes: testChangeEventRows() });

      const response = await app.request(
        signedRequest({ method: "GET", path: "/api/internal/gateway/health" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    });

    /** @scenario "unsigned health probes to the control plane are rejected" */
    it("rejects a health probe without signature headers", async () => {
      const app = composeFamily({ changes: testChangeEventRows() });

      const response = await app.request(
        new Request("http://api.test/api/internal/gateway/health"),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("given the spend pipeline registered producer-only on this process", () => {
    /** @scenario "The ingest door accepts a drained batch and prices it on the way in" */
    it("accepts a drained batch and dispatches it priced", async () => {
      const spendCommands = testSpendCommandSenders();
      const app = composeFamily({ changes: testChangeEventRows(), spendCommands });

      const response = await app.request(
        signedRequest({
          method: "POST",
          path: "/api/internal/gateway/spend-commands",
          body: spendCommandBatchBody(),
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: 1, rejected: [] });
      expect(spendCommands.confirmSpend.sendBatch).toHaveBeenCalledTimes(1);
      // The wire carries quantities and never money, so the figure below can
      // only have come from the rating seam this composition binds.
      const batch = (spendCommands.confirmSpend.sendBatch.mock.calls[0]?.[0] ?? []) as Array<
        Record<string, unknown>
      >;
      expect(batch).toHaveLength(1);
      expect(batch[0]).toMatchObject({
        gateway_request_id: "gwreq_1",
        tenantId: "project-1",
        model: "openai/gpt-5-mini",
      });
      expect(typeof batch[0]?.cost_nano_usd).toBe("number");
      expect(batch[0]?.cost_nano_usd).toBeGreaterThan(0);
      expect(batch[0]?.rate_version).toEqual(expect.any(String));
      expect(spendCommands.admitSpend.send).not.toHaveBeenCalled();
      expect(spendCommands.failSpend.send).not.toHaveBeenCalled();
    });
  });

  describe("given a process that registered no spend pipeline", () => {
    /** @scenario "A process that registered no spend pipeline refuses the whole batch" */
    it("refuses the drained batch with the code the drainer spools against", async () => {
      const app = composeFamily({ changes: testChangeEventRows() });

      const response = await app.request(
        signedRequest({
          method: "POST",
          path: "/api/internal/gateway/spend-commands",
          body: spendCommandBatchBody(),
        }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          type: "unavailable",
          code: "spend_pipeline_disabled",
          message: "gateway spend pipeline is not registered (ClickHouse disabled)",
        },
      });
    });
  });

  describe("given the guardrail check endpoint", () => {
    /** @scenario "the endpoint accepts the directions the gateway actually sends" */
    /** @scenario "every contract direction is accepted" */
    it.each(["request", "response", "stream_chunk"])("accepts direction %s", async (direction) => {
      const app = composeFamily({ changes: testChangeEventRows(), guardrails: testGuardrails() });

      const response = await app.request(
        signedRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: JSON.stringify({
            vk_id: "vk_test",
            project_id: "project-1",
            direction,
            guardrail_ids: [],
            content: { messages: [{ role: "user", content: "hello" }] },
          }),
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: string };
      expect(["allow", "block", "modify"]).toContain(body.decision);
    });

    /** @scenario "a direction outside the contract is rejected" */
    it("rejects a direction outside the contract", async () => {
      const app = composeFamily({ changes: testChangeEventRows(), guardrails: testGuardrails() });

      const response = await app.request(
        signedRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: JSON.stringify({
            vk_id: "vk_test",
            project_id: "project-1",
            direction: "sideways",
            guardrail_ids: [],
          }),
        }),
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_error");
    });

    /** @scenario "the verdict field is named decision, not action" */
    it("names the verdict field decision, which is what the Go client reads", async () => {
      const guardrails = testGuardrails({
        guardrails: [{ id: "gr_1", evaluatorId: "eval_1", failureMode: "FAIL_CLOSED" }],
        monitors: [
          { id: "mon_1", evaluatorId: "eval_1", checkType: "langevals/basic", parameters: {} },
        ],
        runEvaluator: vi.fn(async () => ({
          status: "processed" as const,
          passed: false,
          details: "PII detected: email",
        })),
      });
      const app = composeFamily({ changes: testChangeEventRows(), guardrails });

      const response = await app.request(
        signedRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: JSON.stringify({
            vk_id: "vk_test",
            project_id: "project-1",
            direction: "request",
            guardrail_ids: ["gr_1"],
            content: { messages: [{ role: "user", content: "hello" }] },
          }),
        }),
      );

      const body = (await response.json()) as Record<string, unknown>;
      expect(body.decision).toBe("block");
      expect(body).toHaveProperty("reason");
      expect(body).toHaveProperty("policies_triggered");
      // The Go client used to read "action". If it ever comes back, the two
      // sides have drifted apart again and every verdict silently allows.
      expect(body).not.toHaveProperty("action");
    });
  });

  describe("given a request that carries no signature", () => {
    it("is refused 401 with the body the data plane parses, reaching nothing", async () => {
      const changes = testChangeEventRows();
      const app = composeFamily({ changes });

      const response = await app.request(
        new Request(
          `http://api.test/api/internal/gateway/changes?organization_id=${ORGANIZATION_ID}`,
        ),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: {
          type: "permission_denied",
          code: "missing_signature",
          message: "X-LangWatch-Gateway-Signature and X-LangWatch-Gateway-Timestamp are required",
        },
      });
      expect(changes.findMany).not.toHaveBeenCalled();
    });
  });

  describe("given a request signed with the wrong secret", () => {
    it("is refused 401 as a signature mismatch, reaching nothing", async () => {
      const changes = testChangeEventRows();
      const app = composeFamily({ changes });
      const timestamp = String(Math.floor(Date.now() / 1000));

      const response = await app.request(
        new Request(
          `http://api.test/api/internal/gateway/changes?organization_id=${ORGANIZATION_ID}`,
          {
            headers: {
              "X-LangWatch-Gateway-Signature": computeGatewaySignature(
                "someone-else's-secret",
                buildGatewayCanonicalString({
                  method: "GET",
                  path: "/api/internal/gateway/changes",
                  timestamp,
                  body: "",
                }),
              ),
              "X-LangWatch-Gateway-Timestamp": timestamp,
            },
          },
        ),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: {
          type: "permission_denied",
          code: "invalid_signature",
          message: "signature mismatch",
        },
      });
      expect(changes.findMany).not.toHaveBeenCalled();
    });
  });

  describe("given a process with no JWT signing key", () => {
    it("does not mount the family at all", () => {
      expect(
        composeApiGatewayInternalRest({
          security: ApiRestSecurity.create({
            apiKeys: {} as unknown as ApiKeyService,
            authz: {} as unknown as AuthzService,
            organizations: {} as unknown as OrganizationService,
            observability: ApiRestObservabilityComposition.create(),
          }),
          prisma: {} as unknown as PrismaClient,
          gateway: {
            app: {} as never,
            virtualKeys: {} as never,
            budgetSpend: undefined,
            virtualKeySpend: undefined,
            spendEvents: undefined,
            budgetDecisions: {} as never,
          },
          projects: {} as unknown as ProjectService,
          internalSecret: INTERNAL_SECRET,
          jwtSecret: undefined,
          encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
        }),
      ).toBeUndefined();
    });
  });
});
