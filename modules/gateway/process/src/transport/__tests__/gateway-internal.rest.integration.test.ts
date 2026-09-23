import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * The Go data plane's door: HMAC gate, change feed, spend batch, guardrail verdict, real HTTP.
 * Spec: specs/ai-gateway/gateway-health.feature
 */
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type {
  GatewayGuardrailBundleEntry,
  GatewayGuardrailResource,
} from "@langwatch/gateway-contract";
import type { EnabledGuardrailMonitor, MonitorApi } from "@langwatch/monitor-contract";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { GatewayChangeEvents } from "../../app/gateway.members.ts";
import { gatewayServer } from "../../gateway.server.ts";
import {
  GatewayGuardrailRepository,
  type GatewayGuardrailCheckRow,
} from "../../repositories/gateway-guardrail.repository.ts";
import type { GatewayInternalStoreRepository } from "../../repositories/gateway-internal-store.repository.ts";
import { GatewayGuardrailEvaluationService } from "../../services/gateway-guardrail-evaluation.service.ts";
import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
} from "../../services/gateway-internal-identity.service.ts";
import type { GatewaySpendCommandSender } from "../../services/gateway-internal-protocol.service.ts";
import { ModelCatalogGatewaySpendRatingService } from "../../services/model-catalog-gateway-spend-rating.service.ts";
import { gatewayInternalRest } from "../gateway-internal.rest.ts";
import {
  mountGatewayInternalRest,
  signedGatewayRequest,
} from "./support/gateway-internal-rest.harness.ts";

const ORGANIZATION_ID = "organization-1";

/** The revision feed, as the long poll reads it. */
function testChangeEvents(): GatewayChangeEvents & { since: Mock<GatewayChangeEvents["since"]> } {
  const since = vi.fn<GatewayChangeEvents["since"]>(async () => ({
    currentRevision: 42n,
    events: [
      {
        kind: "VK_CREATED" as const,
        virtualKeyId: "vk_1",
        budgetId: null,
        modelProviderId: null,
        projectId: null,
        revision: 42n,
      },
    ],
  }));

  return {
    since,
    append: vi.fn(async () => ({ revision: 42n })),
    currentRevision: vi.fn(async () => 42n),
  };
}

/** The spend pipeline's senders, as the producer registration publishes them. */
function testSpendCommandSenders() {
  return {
    admitSpend: { send: vi.fn(async (_payload: unknown) => undefined) },
    confirmSpend: {
      send: vi.fn(async (_payload: unknown) => undefined),
      sendBatch: vi.fn(async (_payloads: unknown[]) => undefined),
    },
    failSpend: { send: vi.fn(async (_payload: unknown) => undefined) },
  } satisfies Record<string, GatewaySpendCommandSender>;
}

/** Only the read a data-plane check makes; every other method is out of scope here. */
class TestGuardrailRepository extends GatewayGuardrailRepository {
  constructor(private readonly runnable: GatewayGuardrailCheckRow[]) {
    super();
  }

  override findRunnableForCheck(): Promise<GatewayGuardrailCheckRow[]> {
    return Promise.resolve(this.runnable);
  }

  override findAll(): Promise<GatewayGuardrailResource[]> {
    return Promise.reject(new Error("not used by this test"));
  }
  override findBundleEntries(): Promise<GatewayGuardrailBundleEntry[]> {
    return Promise.reject(new Error("not used by this test"));
  }
  override findById(): Promise<GatewayGuardrailResource | null> {
    return Promise.reject(new Error("not used by this test"));
  }
  override create(): Promise<GatewayGuardrailResource> {
    return Promise.reject(new Error("not used by this test"));
  }
  override update(): Promise<GatewayGuardrailResource> {
    return Promise.reject(new Error("not used by this test"));
  }
  override archive(): Promise<void> {
    return Promise.reject(new Error("not used by this test"));
  }
}

/**
 * The guardrail evaluation service over three test collaborators: the row
 * lookup, the monitor directory and the evaluator runtime — the same three the
 * family refuses the whole route without.
 */
function testGuardrails(options?: {
  guardrails?: GatewayGuardrailCheckRow[];
  monitors?: EnabledGuardrailMonitor[];
  runEvaluator?: () => Promise<SingleEvaluationResult>;
}): GatewayGuardrailEvaluationService {
  return GatewayGuardrailEvaluationService.create({
    repository: new TestGuardrailRepository(options?.guardrails ?? []),
    monitors: createApiFixture<MonitorApi>({
      listEnabledGuardrailMonitors: vi.fn(async () => options?.monitors ?? []),
    }),
    runEvaluator:
      options?.runEvaluator ??
      vi.fn(async (): Promise<SingleEvaluationResult> => ({ status: "processed", passed: true })),
  });
}

/** One drained outcome, in the wire shape the gateway's spooler posts. */
const drainedOutcome = {
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
};

describe("the gateway internal control plane", () => {
  it("publishes the signed control-plane family from the installed gateway module", () => {
    expect(gatewayServer.transports).toContain(gatewayInternalRest);
  });

  describe("given a request signed with the shared internal secret", () => {
    it("passes the HMAC gate and reaches the change feed", async () => {
      const changes = testChangeEvents();
      const app = mountGatewayInternalRest({ changes });

      const response = await app.request(
        signedGatewayRequest({
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
      expect(changes.since).toHaveBeenCalledWith(ORGANIZATION_ID, 0n, 500);
    });

    /** @scenario "control plane answers the gateway's signed health probe" */
    it("answers the connectivity probe the data plane's status monitor polls", async () => {
      const app = mountGatewayInternalRest({});

      const response = await app.request(
        signedGatewayRequest({ method: "GET", path: "/api/internal/gateway/health" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    });

    /** @scenario "unsigned health probes to the control plane are rejected" */
    it("rejects a health probe without signature headers", async () => {
      const app = mountGatewayInternalRest({});

      const response = await app.request(
        new Request("http://api.test/api/internal/gateway/health"),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("given the spend pipeline registered producer-only on this process", () => {
    /** @scenario "The ingest door accepts a drained batch and prices it on the way in" */
    it("accepts a drained batch and dispatches it priced", async () => {
      const commands = testSpendCommandSenders();
      const app = mountGatewayInternalRest({
        store: {} as GatewayInternalStoreRepository,
        spend: { commands, rating: ModelCatalogGatewaySpendRatingService.create() },
      });

      const response = await app.request(
        signedGatewayRequest({
          method: "POST",
          path: "/api/internal/gateway/spend-commands",
          body: drainedOutcome,
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: 1, rejected: [] });
      expect(commands.confirmSpend.sendBatch).toHaveBeenCalledTimes(1);
      // The wire carries quantities and never money, so the figure below can
      // only have come from the rating seam this family binds.
      const batch = (commands.confirmSpend.sendBatch.mock.calls[0]?.[0] ?? []) as Record<
        string,
        unknown
      >[];
      expect(batch).toHaveLength(1);
      expect(batch[0]).toMatchObject({
        gateway_request_id: "gwreq_1",
        tenantId: "project-1",
        model: "openai/gpt-5-mini",
      });
      expect(typeof batch[0]?.cost_nano_usd).toBe("number");
      expect(batch[0]?.cost_nano_usd).toBeGreaterThan(0);
      expect(batch[0]?.rate_version).toEqual(expect.any(String));
      expect(commands.admitSpend.send).not.toHaveBeenCalled();
      expect(commands.failSpend.send).not.toHaveBeenCalled();
    });
  });

  describe("given a process that registered no spend pipeline", () => {
    /** @scenario "A process that registered no spend pipeline refuses the whole batch" */
    it("refuses the drained batch with the code the drainer spools against", async () => {
      const app = mountGatewayInternalRest({ spend: undefined });

      const response = await app.request(
        signedGatewayRequest({
          method: "POST",
          path: "/api/internal/gateway/spend-commands",
          body: drainedOutcome,
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
      const app = mountGatewayInternalRest({ guardrails: testGuardrails() });

      const response = await app.request(
        signedGatewayRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: {
            vk_id: "vk_test",
            project_id: "project-1",
            direction,
            guardrail_ids: [],
            content: { messages: [{ role: "user", content: "hello" }] },
          },
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: string };
      expect(["allow", "block", "modify"]).toContain(body.decision);
    });

    /** @scenario "a direction outside the contract is rejected" */
    it("rejects a direction outside the contract", async () => {
      const app = mountGatewayInternalRest({ guardrails: testGuardrails() });

      const response = await app.request(
        signedGatewayRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: {
            vk_id: "vk_test",
            project_id: "project-1",
            direction: "sideways",
            guardrail_ids: [],
          },
        }),
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_error");
    });

    /** @scenario "the verdict field is named decision, not action" */
    it("names the verdict field decision, which is what the Go client reads", async () => {
      const app = mountGatewayInternalRest({
        guardrails: testGuardrails({
          guardrails: [
            { id: "gr_1", name: "PII", evaluatorId: "eval_1", failureMode: "FAIL_CLOSED" },
          ],
          monitors: [
            { id: "mon_1", evaluatorId: "eval_1", checkType: "langevals/basic", parameters: {} },
          ],
          runEvaluator: vi.fn(async (): Promise<SingleEvaluationResult> => ({
            status: "processed",
            passed: false,
            details: "PII detected: email",
          })),
        }),
      });

      const response = await app.request(
        signedGatewayRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: {
            vk_id: "vk_test",
            project_id: "project-1",
            direction: "request",
            guardrail_ids: ["gr_1"],
            content: { messages: [{ role: "user", content: "hello" }] },
          },
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

    it("refuses rather than allows when this deployment composes no evaluator runtime", async () => {
      const app = mountGatewayInternalRest({ guardrails: undefined });

      const response = await app.request(
        signedGatewayRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: {
            vk_id: "vk_test",
            project_id: "project-1",
            direction: "request",
            guardrail_ids: ["gr_1"],
          },
        }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          type: "unavailable",
          code: "guardrail_evaluation_unavailable",
          message: "this deployment composes no evaluator runtime to check a guardrail with",
        },
      });
    });
  });

  describe("given a request that carries no signature", () => {
    it("is refused 401 with the body the data plane parses, reaching nothing", async () => {
      const changes = testChangeEvents();
      const app = mountGatewayInternalRest({ changes });

      const response = await app.request(
        new Request(
          `http://api.test/api/internal/gateway/changes?organization_id=${ORGANIZATION_ID}`,
        ),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        type: "unauthenticated",
        code: "permission_denied",
        meta: { reason: "missing_signature" },
      });
      expect(changes.since).not.toHaveBeenCalled();
    });
  });

  describe("given a request signed with the wrong secret", () => {
    it("is refused 401 as a signature mismatch, reaching nothing", async () => {
      const changes = testChangeEvents();
      const app = mountGatewayInternalRest({ changes });
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
      expect(await response.json()).toMatchObject({
        type: "unauthenticated",
        code: "permission_denied",
        meta: { reason: "invalid_signature" },
      });
      expect(changes.since).not.toHaveBeenCalled();
    });
  });

  describe("given a deployment that configured no gateway secret", () => {
    it("refuses every call rather than letting an unset secret admit everyone", async () => {
      const unset = mountGatewayInternalRest({ changes: testChangeEvents() }, { secret: "" });

      const response = await unset.request(
        new Request("http://api.test/api/internal/gateway/health"),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        type: "internal_error",
        code: "internal_error",
      });
    });
  });
});
