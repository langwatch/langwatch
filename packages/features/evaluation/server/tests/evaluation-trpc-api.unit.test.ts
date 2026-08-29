/**
 * @vitest-environment node
 *
 * The `evaluations.*` tRPC surface: the four procedure names the evaluator
 * pickers and the try-it-out panel call, how an evaluator's readiness is
 * reported, and what a single re-run dispatches afterwards.
 *
 * Covers the @integration scenarios from
 * specs/evaluators/azure-safety-byok-gating.feature:
 * - "availableEvaluators reports missing env vars for Azure when provider is absent"
 * - "availableEvaluators reports no missing env vars when provider is fully configured"
 * - "availableEvaluators ignores process.env for Azure evaluators"
 *
 * The procedure handed in narrows its own context the way an authenticated
 * process procedure does, so this also pins that a process can hand over a
 * procedure it has already composed.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  EvaluationTrpcApi,
  type EvaluationRunOutcome,
  type EvaluationTrpcPorts,
} from "../src/transport/api-trpc/evaluation.api";

const PROJECT_ID = "proj-byok-1";
const USER_ID = "user-test";

const mappingsSchema = z.object({
  mapping: z.record(z.string(), z.unknown()),
  expansions: z.array(z.string()),
});

type Mappings = z.infer<typeof mappingsSchema>;

type TestContext = {
  app: { evaluations: { reportEvaluation(data: unknown): Promise<unknown> } };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

const PROCESSED_RESULT = {
  status: "processed",
  score: 0.75,
  passed: true,
  label: "ok",
  details: "looks fine",
} as unknown as EvaluationRunOutcome;

function harness({
  ports = {},
}: {
  ports?: Partial<EvaluationTrpcPorts<unknown, Mappings, { id: string }>>;
} = {}) {
  const reportEvaluation = vi.fn(async () => undefined);
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const router = EvaluationTrpcApi.create(
    trpc,
    { protected: authenticated, policy: () => (procedure) => procedure },
    {
      mappingsSchema,
      tryResolveAzureSafetyEnv: async () => null,
      evaluatorUnavailability: () => undefined,
      missingEnvironmentVariables: (envVars) => envVars.filter((envVar) => !process.env[envVar]),
      listCustomEvaluators: async () => [],
      runEvaluationForTrace: async () => PROCESSED_RESULT,
      trackEvaluationRan: () => {},
      sendKeepAliveProbe: async () => {},
      ...ports,
    },
  );

  return {
    reportEvaluation,
    caller: router.createCaller({
      app: { evaluations: { reportEvaluation } },
      actor: () => ({ id: USER_ID }),
      session: { user: { id: USER_ID } },
    }),
  };
}

describe("EvaluationTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { caller } = harness();
      expect(typeof caller.availableEvaluators).toBe("function");

      const trpc = initTRPC.context<TestContext>().create();
      const router = EvaluationTrpcApi.create(
        trpc,
        { protected: trpc.procedure, policy: () => (procedure) => procedure },
        {
          mappingsSchema,
          tryResolveAzureSafetyEnv: async () => null,
          evaluatorUnavailability: () => undefined,
          missingEnvironmentVariables: (envVars) =>
            envVars.filter((envVar) => !process.env[envVar]),
          listCustomEvaluators: async () => [],
          runEvaluationForTrace: async () => PROCESSED_RESULT,
          trackEvaluationRan: () => {},
          sendKeepAliveProbe: async () => {},
        },
      );

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "availableCustomEvaluators",
        "availableEvaluators",
        "runEvaluation",
        "warmupLambda",
      ]);
    });
  });

  describe("Feature: availableEvaluators — Azure BYOK", () => {
    beforeEach(() => {
      process.env.AZURE_CONTENT_SAFETY_ENDPOINT = "https://shared.example.com/";
      process.env.AZURE_CONTENT_SAFETY_KEY = "shared-key";
    });

    afterEach(() => {
      delete process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
      delete process.env.AZURE_CONTENT_SAFETY_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    describe("given the project has no azure_safety provider", () => {
      const absent = { tryResolveAzureSafetyEnv: async () => null };

      it("marks azure/content_safety with missingEnvVars", async () => {
        const { caller } = harness({ ports: absent });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        expect(result["azure/content_safety"]?.missingEnvVars).toEqual([
          "AZURE_CONTENT_SAFETY_ENDPOINT",
          "AZURE_CONTENT_SAFETY_KEY",
        ]);
      });

      it("marks azure/prompt_injection with missingEnvVars", async () => {
        const { caller } = harness({ ports: absent });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        expect(result["azure/prompt_injection"]?.missingEnvVars).toEqual([
          "AZURE_CONTENT_SAFETY_ENDPOINT",
          "AZURE_CONTENT_SAFETY_KEY",
        ]);
      });

      it("marks azure/jailbreak with missingEnvVars", async () => {
        const { caller } = harness({ ports: absent });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        expect(result["azure/jailbreak"]?.missingEnvVars).toEqual([
          "AZURE_CONTENT_SAFETY_ENDPOINT",
          "AZURE_CONTENT_SAFETY_KEY",
        ]);
      });

      it("ignores process.env for Azure evaluators", async () => {
        // process.env has AZURE_CONTENT_SAFETY_* set in beforeEach but the
        // router must NOT use it.
        const { caller } = harness({ ports: absent });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        expect(result["azure/content_safety"]?.missingEnvVars).toHaveLength(2);
      });

      it("still reads non-Azure envVars from process.env", async () => {
        process.env.OPENAI_API_KEY = "sk-test";
        const { caller } = harness({ ports: absent });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        // openai/moderation declares OPENAI_API_KEY in envVars;
        // with it set in process.env, missingEnvVars is empty.
        expect(result["openai/moderation"]?.missingEnvVars).toEqual([]);
      });

      it("resolves the credentials once, for the project the caller named", async () => {
        const tryResolveAzureSafetyEnv = vi.fn(async () => null);
        const { caller } = harness({ ports: { tryResolveAzureSafetyEnv } });

        await caller.availableEvaluators({ projectId: PROJECT_ID });

        expect(tryResolveAzureSafetyEnv).toHaveBeenCalledTimes(1);
        expect(tryResolveAzureSafetyEnv).toHaveBeenCalledWith(expect.anything(), {
          projectId: PROJECT_ID,
        });
      });
    });

    describe("given the project has azure_safety configured", () => {
      const configured = {
        tryResolveAzureSafetyEnv: async () => ({
          AZURE_CONTENT_SAFETY_ENDPOINT: "https://byok.cognitiveservices.azure.com/",
          AZURE_CONTENT_SAFETY_KEY: "byok-key",
        }),
      };

      it("marks azure/content_safety with empty missingEnvVars", async () => {
        const { caller } = harness({ ports: configured });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        expect(result["azure/content_safety"]?.missingEnvVars).toEqual([]);
      });

      it("marks azure/prompt_injection with empty missingEnvVars", async () => {
        const { caller } = harness({ ports: configured });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        expect(result["azure/prompt_injection"]?.missingEnvVars).toEqual([]);
      });

      it("marks azure/jailbreak with empty missingEnvVars", async () => {
        const { caller } = harness({ ports: configured });
        const result = await caller.availableEvaluators({ projectId: PROJECT_ID });
        expect(result["azure/jailbreak"]?.missingEnvVars).toEqual([]);
      });
    });
  });

  describe("when an evaluator's code is not installed here", () => {
    it("says so, separately from it being unconfigured", async () => {
      const unavailability = {
        reason: "PII detection is not installed on this server.",
        howToEnable: "Set LANGWATCH_ENABLE_PRESIDIO=true and restart LangWatch.",
      };
      const { caller } = harness({
        ports: {
          evaluatorUnavailability: ({ evaluatorType }) =>
            evaluatorType.startsWith("presidio/") ? unavailability : undefined,
        },
      });

      const result = await caller.availableEvaluators({ projectId: PROJECT_ID });

      expect(result["presidio/pii_detection"]?.unavailable).toEqual(unavailability);
      expect(result["openai/moderation"]?.unavailable).toBeUndefined();
    });
  });

  describe("when the client asks for the project's custom evaluators", () => {
    it("hands back what the process resolved, for that project", async () => {
      const listCustomEvaluators = vi.fn(async () => [{ id: "workflow_1" }]);
      const { caller } = harness({ ports: { listCustomEvaluators } });

      const result = await caller.availableCustomEvaluators({ projectId: PROJECT_ID });

      expect(result).toEqual([{ id: "workflow_1" }]);
      expect(listCustomEvaluators).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    });
  });

  describe("when one trace is re-evaluated", () => {
    const runInput = {
      projectId: PROJECT_ID,
      evaluatorType: "langevals/basic" as const,
      traceId: "trace_1",
      settings: {},
      mappings: { mapping: {}, expansions: [] },
    };

    it("returns the evaluator's result to the caller", async () => {
      const { caller } = harness();

      expect(await caller.runEvaluation(runInput)).toEqual(PROCESSED_RESULT);
    });

    it("reports the run into the evaluation pipeline against the project's tenant", async () => {
      const { caller, reportEvaluation } = harness();

      await caller.runEvaluation(runInput);

      expect(reportEvaluation).toHaveBeenCalledTimes(1);
      expect(reportEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: PROJECT_ID,
          evaluatorId: "langevals/basic",
          evaluatorType: "langevals/basic",
          traceId: "trace_1",
          status: "processed",
          score: 0.75,
          passed: true,
          label: "ok",
          details: "looks fine",
        }),
      );
    });

    it("still answers the caller when the pipeline dispatch fails", async () => {
      const trpc = initTRPC.context<TestContext>().create();
      const router = EvaluationTrpcApi.create(
        trpc,
        { protected: trpc.procedure, policy: () => (procedure) => procedure },
        {
          mappingsSchema,
          tryResolveAzureSafetyEnv: async () => null,
          evaluatorUnavailability: () => undefined,
          missingEnvironmentVariables: (envVars) =>
            envVars.filter((envVar) => !process.env[envVar]),
          listCustomEvaluators: async () => [],
          runEvaluationForTrace: async () => PROCESSED_RESULT,
          trackEvaluationRan: () => {},
          sendKeepAliveProbe: async () => {},
        },
      );
      const caller = router.createCaller({
        app: {
          evaluations: {
            reportEvaluation: async () => {
              throw new Error("queue unavailable");
            },
          },
        },
        actor: () => ({ id: USER_ID }),
        session: { user: { id: USER_ID } },
      });

      expect(await caller.runEvaluation(runInput)).toEqual(PROCESSED_RESULT);
    });

    it("attributes the run to the caller", async () => {
      const trackEvaluationRan = vi.fn();
      const { caller } = harness({ ports: { trackEvaluationRan } });

      await caller.runEvaluation(runInput);

      expect(trackEvaluationRan).toHaveBeenCalledWith({
        userId: USER_ID,
        projectId: PROJECT_ID,
      });
    });

    it("accepts a custom evaluator type", async () => {
      const runEvaluationForTrace = vi.fn(async () => PROCESSED_RESULT);
      const { caller } = harness({ ports: { runEvaluationForTrace } });

      await caller.runEvaluation({ ...runInput, evaluatorType: "custom/workflow_1" });

      expect(runEvaluationForTrace).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ evaluatorType: "custom/workflow_1" }),
      );
    });

    it("refuses an evaluator type that is neither known nor custom", async () => {
      const runEvaluationForTrace = vi.fn(async () => PROCESSED_RESULT);
      const { caller } = harness({ ports: { runEvaluationForTrace } });

      await expect(
        caller.runEvaluation({ ...runInput, evaluatorType: "not_an_evaluator" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(runEvaluationForTrace).not.toHaveBeenCalled();
    });
  });

  describe("when the client warms the evaluator runtime", () => {
    it("sends one probe per requested instance and reports the count", async () => {
      const sendKeepAliveProbe = vi.fn(async () => {});
      const { caller } = harness({ ports: { sendKeepAliveProbe } });

      const result = await caller.warmupLambda({ projectId: PROJECT_ID, count: 3 });

      expect(result).toEqual({ success: true, count: 3 });
      expect(sendKeepAliveProbe).toHaveBeenCalledTimes(3);
    });

    it("sends five probes when the client names no count", async () => {
      const sendKeepAliveProbe = vi.fn(async () => {});
      const { caller } = harness({ ports: { sendKeepAliveProbe } });

      const result = await caller.warmupLambda({ projectId: PROJECT_ID });

      expect(result).toEqual({ success: true, count: 5 });
      expect(sendKeepAliveProbe).toHaveBeenCalledTimes(5);
    });

    it("succeeds even when every probe fails — a warmup is not a health check", async () => {
      const { caller } = harness({
        ports: {
          sendKeepAliveProbe: async () => {
            throw new Error("lambda cold");
          },
        },
      });

      expect(await caller.warmupLambda({ projectId: PROJECT_ID, count: 2 })).toEqual({
        success: true,
        count: 2,
      });
    });
  });
});
