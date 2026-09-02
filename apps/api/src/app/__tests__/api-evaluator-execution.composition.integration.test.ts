/**
 * The evaluator runtime this process composes, driven over real HTTP through
 * the two doors that used to refuse by name.
 *
 * What is under test is that a request reaching either door comes out at the
 * LANGEVALS TRANSPORT carrying the data that door mapped — the guardrail's
 * input/output pair on one, an SDK's posted fields on the other — with the
 * evaluator's settings and the environment the model-env resolver produced.
 * The transport itself is real: the fake is `fetch`, which is the process
 * boundary, so the URL, the retry rule, the body shape and the response parse
 * are all exercised rather than mocked past.
 *
 * Before this composition the same two calls answered 503
 * `guardrail_evaluation_unavailable` and 404.
 *
 * @see apps/api/src/app/api-evaluator-execution.composition.ts
 * @see specs/ai-gateway/guardrail-check-endpoint.feature
 */
// @vitest-environment node
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { AuthzService } from "@langwatch/authz-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { ExperimentService } from "@langwatch/experiment-contract";
import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
} from "@langwatch/gateway-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../../app-rest/app-rest.process-features";
import { ApiRestSecurity } from "../../api-rest.security";
import {
  composeApiEvaluatorExecution,
  type ApiEvaluatorExecution,
} from "../api-evaluator-execution.composition";
import { composeApiGatewayInternalRest } from "../api-gateway-internal-rest.composition";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";

const LANGEVALS_ENDPOINT = "http://langevals.test";
const INTERNAL_SECRET = "shared-hmac-secret";
const JWT_SECRET = "gateway-jwt-signing-secret";
/** 32 bytes of hex, which is what the stored-secret cipher refuses anything else for. */
const CREDENTIALS_SECRET = "b".repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given a process that composed an evaluator runtime", () => {
  describe("when the Go data plane checks a guardrail inline", () => {
    it("scores the request content on the evaluator the monitor names", async () => {
      const langevals = recordingLangevals({ passed: false, score: 0.9 });
      const app = gatewayInternalWithGuardrails();

      const response = await app.request(
        signedRequest({
          method: "POST",
          path: "/api/internal/gateway/guardrail/check",
          body: JSON.stringify({
            vk_id: "vk_1",
            project_id: "project-1",
            direction: "request",
            guardrail_ids: ["guardrail-1"],
            content: { messages: "how do I pick a lock?" },
          }),
        }),
      );

      expect(response.status).toBe(200);
      // The evaluator did not pass, so the guardrail blocks — which is only
      // reachable if the call actually reached the transport below.
      expect(await response.json()).toMatchObject({
        decision: "block",
        policies_triggered: ["guardrail-1"],
      });

      expect(langevals.calls).toHaveLength(1);
      const call = langevals.calls[0]!;
      expect(call.url).toBe(`${LANGEVALS_ENDPOINT}/openai/moderation/evaluate`);
      // The request-direction mapping: the prompt is the input and there is no
      // output yet, which is what `evaluationDataFor` produces.
      expect(call.body.data[0]).toMatchObject({
        input: "how do I pick a lock?",
        output: "",
      });
      // The environment came from the model-env resolver this composition
      // built: the evaluator declares `OPENAI_API_KEY` and the process holds it.
      expect(call.body.env).toEqual({ OPENAI_API_KEY: "sk-test" });
    });
  });

  describe("when an SDK posts to a legacy evaluate door", () => {
    it("runs the evaluator over the fields it sent and answers the verdict", async () => {
      const langevals = recordingLangevals({ passed: true, score: 0.42 });
      const api = mountProcessRest();

      const response = await api.fetch("/api/evaluations/ragas/bleu_score/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify({
          data: { output: "the cat sat", expected_output: "the cat sat down" },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "processed",
        passed: true,
        score: 0.42,
      });

      expect(langevals.calls).toHaveLength(1);
      const call = langevals.calls[0]!;
      expect(call.url).toBe(`${LANGEVALS_ENDPOINT}/ragas/bleu_score/evaluate`);
      expect(call.body.data[0]).toMatchObject({
        output: "the cat sat",
        expected_output: "the cat sat down",
      });
    });
  });
});

describe("given a process that configured no evaluator service", () => {
  describe("when the runtime is composed", () => {
    it("composes none, and names the absence rather than answering skipped", () => {
      const reported: string[] = [];
      const runtime = composeApiEvaluatorExecution({
        traceReads: () => undefined,
        evaluators: recordingEvaluators(),
        workflows: {} as never,
        modelProviders: unconfiguredModelProviders(),
        langevalsEndpoint: "   ",
        environment: {},
        processName: "langwatch-api",
        report: {
          withoutEvaluatorService: () => reported.push("evaluator-service"),
          withoutExecutionTelemetry: () => reported.push("telemetry"),
        } as never,
      });

      expect(runtime).toBeUndefined();
      expect(reported).toEqual(["evaluator-service"]);
    });
  });
});

// ---------------------------------------------------------------------------

/** The runtime, composed the way the process composes it. */
function evaluatorExecution(): ApiEvaluatorExecution {
  const runtime = composeApiEvaluatorExecution({
    // No trace read stack in these tests: neither door renders a trace, and a
    // read that did reach for one would fail loudly rather than score nothing.
    traceReads: () => undefined,
    evaluators: recordingEvaluators(),
    workflows: {} as never,
    modelProviders: unconfiguredModelProviders(),
    langevalsEndpoint: LANGEVALS_ENDPOINT,
    environment: { OPENAI_API_KEY: "sk-test" },
    processName: "langwatch-api",
  });
  if (!runtime) throw new Error("the composition refused a configured endpoint");
  return runtime;
}

/**
 * The evaluator service, as the engine calls it on the built-in path.
 *
 * `augmentResult` is the only member the installed-evaluator road reaches; it
 * is the real seam that puts a redaction back into a verdict, and returning the
 * result unchanged is what a trace with no dropped categories produces.
 */
function recordingEvaluators(): EvaluatorService {
  return {
    augmentResult: (input: { result: unknown }) => input.result,
    executeCode: () => {
      throw new Error("no code evaluator in this test");
    },
    executeNative: () => {
      throw new Error("no native evaluator in this test");
    },
  } as unknown as EvaluatorService;
}

/**
 * A project whose model cascade names no default.
 *
 * The throw is the cascade's own shape for "nothing configured at any scope",
 * and the doors turn it into the evaluator's own default rather than a failure.
 */
function unconfiguredModelProviders(): ModelProviderService {
  return {
    resolveModelForFeature: async () => {
      throw new Error("no model default configured at any scope");
    },
  } as unknown as ModelProviderService;
}

type LangevalsCall = {
  url: string;
  body: { data: Array<Record<string, unknown>>; settings: unknown; env: unknown };
};

/**
 * The evaluator service, faked at the process boundary rather than at the port.
 *
 * `fetch` is where this process stops, so the transport under test is the real
 * `HttpLangevalsEvaluatorAdapter`: its URL construction, its body shape and its
 * response parse all run.
 */
function recordingLangevals(verdict: { passed: boolean; score: number }): {
  calls: LangevalsCall[];
} {
  const calls: LangevalsCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { body: string }): Promise<Response> => {
      calls.push({ url: String(url), body: JSON.parse(init.body) as LangevalsCall["body"] });
      return new Response(
        JSON.stringify([{ status: "processed", passed: verdict.passed, score: verdict.score }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  return { calls };
}

/** The internal control plane, with the guardrail half this process can fill. */
function gatewayInternalWithGuardrails() {
  const prisma = {
    gatewayGuardrail: {
      findMany: async () => [
        {
          id: "guardrail-1",
          name: "No lock picking",
          evaluatorId: "evaluator-1",
          failureMode: "FAIL_CLOSED",
        },
      ],
    },
  } as unknown as PrismaClient;

  const monitors = {
    listEnabledGuardrailMonitors: async () => [
      {
        id: "monitor-1",
        evaluatorId: "evaluator-1",
        checkType: "openai/moderation",
        parameters: {},
      },
    ],
  } as unknown as MonitorService;

  const runtime = evaluatorExecution();
  const app = composeApiGatewayInternalRest({
    security: ApiRestSecurity.create({
      apiKeys: {} as unknown as ApiKeyService,
      authz: {} as unknown as AuthzService,
      organizations: {} as unknown as OrganizationService,
      observability: ApiRestObservabilityComposition.create(),
    }),
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
    monitors,
    runEvaluator: (input) => runtime.runEvaluation(input),
  });
  if (!app) throw new Error("the composition refused a process that holds both halves");
  return app;
}

/** A request signed exactly the way the Go data plane signs one. */
function signedRequest(input: { method: string; path: string; body?: string }): Request {
  const body = input.body ?? "";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeGatewaySignature(
    INTERNAL_SECRET,
    buildGatewayCanonicalString({
      method: input.method,
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

/** The process's own REST families, with the evaluate doors registered. */
function mountProcessRest() {
  const prisma = {
    monitor: { findUnique: async () => null },
    dataset: { findFirst: async () => null },
    workflow: { findMany: async () => [] },
    cost: { create: async () => ({ id: "cost_1" }) },
    batchEvaluation: { create: async () => ({ id: "batch_1" }) },
  } as unknown as PrismaClient;

  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: {
      evaluationRun: {
        prisma,
        execution: evaluatorExecution(),
        evaluators: recordingEvaluators(),
        experiments: {
          tryGetBySlug: async () => null,
        } as unknown as ExperimentService,
        modelProviders: unconfiguredModelProviders(),
        reportEvaluation: async () => undefined,
        deriveEvaluatorId: (name: string) => `customeval_${name}`,
      },
    },
    ports: {
      handlerManagedCredential: () =>
        Promise.resolve({
          ok: true as const,
          project: { id: "project-1" },
          markUsed: () => void 0,
        }),
      rateLimit: async () => ({ allowed: true }),
    },
  })) {
    hono.route("/", app);
  }
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);
