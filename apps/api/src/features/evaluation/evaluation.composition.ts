/**
 * One trace re-scored, and the pipeline the result is reported on, composed as
 * their own feature.
 *
 * `evaluations.*` is the evaluator inventory a project can run and the re-score
 * of one trace against one of them. Beside it this feature composes the
 * `reportEvaluation` sender the workbench's own runs report through, because
 * both write onto the SAME `evaluation_processing` pipeline: two registrations
 * of one event stream drift into jobs the worker cannot route.
 *
 * ## What is absent, and what that costs
 *
 *   - With no eventing runtime, `reportEvaluation` refuses by name. A re-score
 *     that silently reported nothing would leave the customer looking at a
 *     result the analytics never received.
 *   - With no evaluator runtime composed, a re-score refuses by name rather
 *     than scoring against an empty trace. The runtime is built FROM the
 *     evaluator service and the trace reads, one composed on either side of
 *     this feature, so it arrives as a call-time resolution.
 *   - `mappingsSchema` is the trace-mapping registry's, and that registry lives
 *     in a browser package no server module may value-import. It defaults to a
 *     permissive parse, and the narrowing it would have done is named here.
 */
import {
  EvaluationProcessingProducerAdapter,
  EvaluatorAvailabilityService,
  type EvaluationRunOutcome,
} from "@langwatch/evaluation-server";
import {
  AZURE_SAFETY_PROVIDER_KEY,
  type ReportEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import type { EventSourcing } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { getProjectModelProviders } from "@langwatch/model-provider-server";
import { createLogger } from "@langwatch/observability";
import { HttpWorkflowNlpRuntimeAdapter } from "@langwatch/workflow-server";
import type { ZodTypeAny } from "zod";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { permissiveMappingsSchema } from "../trace/trace-mappings";
import type { ApiWorkflowRuntime } from "../workflow/workflow.composition";
import { createEvaluationTrpcRouter, type EvaluationMountPorts } from "./evaluation-trpc.mount";

/** What the evaluation surface reaches that this feature does not own. */
export type EvaluationPeers = Readonly<{
  /** The gateway a project's Azure Safety credentials are read from. */
  modelProviders: ModelProviderService;
  /** Where a code evaluator and the keep-alive probe both go. */
  workflowRuntime: ApiWorkflowRuntime;
}>;

/** The namespace, the `ctx.app.evaluations` slice and the pipeline sender. */
export type ComposedEvaluationFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createEvaluationTrpcRouter>;
  /** For `ctx.app.evaluations`. */
  app: Readonly<{ reportEvaluation(data: never): Promise<unknown> }>;
  /**
   * The pipeline sender itself, as the experiment run loop and the evaluator
   * runtime take it. ONE registration, handed out rather than repeated.
   */
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<unknown>;
}>;

/** Composes the evaluation surface over this process's own graph. */
export function composeEvaluationFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: EvaluationPeers;
  /** Names this process in a refusal a stand-in raises. */
  processName: string;
  /** The producer-only eventing runtime the pipeline is registered on. */
  eventing: EventSourcing | undefined;
  /** Scores one trace with one evaluator. Absent refuses by name. */
  runEvaluationForTrace?: NonNullable<
    EvaluationMountPorts<unknown, unknown>
  >["runEvaluationForTrace"];
  /** The parser for a run's field mappings, when the deployment has the registry. */
  mappingsSchema?: ZodTypeAny;
  /** Product signal for a completed evaluation run. */
  trackEvaluationRan?: (input: { userId: string; projectId: string }) => void;
  /** The process environment, for the evaluator-install questions. */
  environment?: Readonly<Record<string, string | undefined>>;
}): ComposedEvaluationFeature {
  const logger = createLogger("langwatch:api:evaluation");
  const environment = options.environment ?? process.env;
  const { nlpRuntime } = options.peers.workflowRuntime;

  const reportEvaluation = composeReportEvaluation({
    eventing: options.eventing,
    processName: options.processName,
  });

  const ports: EvaluationMountPorts<unknown, unknown> = {
    mappingsSchema: (options.mappingsSchema ?? permissiveMappingsSchema) as EvaluationMountPorts<
      unknown,
      unknown
    >["mappingsSchema"],

    /**
     * Azure Content Safety credentials come solely from the project's
     * `azure_safety` model provider. There is no `process.env` fallback, so an
     * unconfigured provider deterministically resolves to null and the package
     * reports every Azure variable as missing.
     *
     * Spec: specs/evaluators/azure-safety-byok-gating.feature.
     */
    tryResolveAzureSafetyEnv: async (_ctx, input) => {
      const providers = await getProjectModelProviders(
        options.peers.modelProviders,
        input.projectId,
      );
      const provider = providers[AZURE_SAFETY_PROVIDER_KEY];
      if (!provider?.enabled) return null;

      const endpoint = provider.customKeys?.AZURE_CONTENT_SAFETY_ENDPOINT;
      const key = provider.customKeys?.AZURE_CONTENT_SAFETY_KEY;
      if (typeof endpoint !== "string" || endpoint.trim() === "") return null;
      if (typeof key !== "string" || key.trim() === "") return null;

      return {
        AZURE_CONTENT_SAFETY_ENDPOINT: endpoint,
        AZURE_CONTENT_SAFETY_KEY: key,
      };
    },

    evaluatorUnavailability: (input) =>
      EvaluatorAvailabilityService.evaluatorUnavailability({
        evaluatorType: input.evaluatorType,
        environment,
      }),

    missingEnvironmentVariables: (envVars) => [...envVars].filter((name) => !environment[name]),

    runEvaluationForTrace: async (ctx, input) => {
      if (!options.runEvaluationForTrace) {
        throw new ApiEvaluationUnavailableError(
          "trace read pipeline, so it cannot score a trace on demand",
        );
      }
      return (await options.runEvaluationForTrace(ctx, input)) as EvaluationRunOutcome;
    },

    trackEvaluationRan: (input) => options.trackEvaluationRan?.(input),

    /**
     * One liveness probe at the evaluator backend.
     *
     * The platform app sent this down the engine's STREAMING route, which is
     * the per-project Lambda path this process does not carry. Same engine,
     * same process warmed; a probe that is not answered warmed nothing, which
     * is why the failure is swallowed rather than raised.
     */
    sendKeepAliveProbe: async (_ctx, input) => {
      if (!(nlpRuntime instanceof HttpWorkflowNlpRuntimeAdapter)) return;
      try {
        await nlpRuntime.probe({ projectId: input.projectId });
      } catch (error) {
        logger.debug({ error, projectId: input.projectId }, "evaluator keep-alive probe failed");
      }
    },
  };

  return {
    reportEvaluation,
    app: { reportEvaluation: reportEvaluation as (data: never) => Promise<unknown> },
    router: (mount) =>
      createEvaluationTrpcRouter({ ...mount, prisma: options.infrastructure.prisma, ports }),
  };
}

/**
 * The evaluation surface on a process that composed no graph to run it over.
 *
 * The namespace still mounts and every call refuses by name, so a person is
 * told this deployment scores nothing rather than shown an empty evaluator
 * inventory.
 */
export function refusingEvaluationFeature(): ComposedEvaluationFeature {
  const refuse = (): never => {
    throw new ApiEvaluationUnavailableError("evaluation pipeline");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;
  const ports = refuseEvery<EvaluationMountPorts<unknown, unknown>>();
  // The custom-evaluator read runs on the connection this process does not
  // have, so it refuses where it is asked for rather than answering an empty
  // inventory a project would read as "this deployment offers nothing".
  const prisma = refuseEvery<ApiTrpcInfrastructure["prisma"]>();
  const reportEvaluation = () => Promise.reject(new ApiEvaluationUnavailableError("command queue"));

  return {
    reportEvaluation,
    app: { reportEvaluation: reportEvaluation as (data: never) => Promise<unknown> },
    router: (mount) => createEvaluationTrpcRouter({ ...mount, prisma, ports }),
  };
}

/**
 * Registers the `evaluation_processing` pipeline as a PRODUCER and hands back
 * its `reportEvaluation` sender.
 *
 * The SAME packaged definition the worker installs — nothing here forks it,
 * because the routing triple every job carries is derived from the pipeline
 * and command names, and two descriptions of one event stream drift into jobs
 * the worker cannot route. Registration is passive: this process starts no
 * consumer loop and owns no event log.
 */
function composeReportEvaluation(input: {
  eventing: EventSourcing | undefined;
  processName: string;
}): (data: ReportEvaluationCommandData) => Promise<unknown> {
  if (!input.eventing) {
    return () =>
      Promise.reject(
        new ApiEvaluationUnavailableError(
          "command queue, so it cannot report an evaluation to the processing pipeline",
        ),
      );
  }

  const registered = input.eventing.register(
    EvaluationProcessingProducerAdapter.createPipeline({ processName: input.processName }),
  );
  const sender = (registered.commands as Record<string, unknown>).reportEvaluation;
  if (!isSender(sender)) {
    throw new Error(
      'The evaluation_processing registration produced no "reportEvaluation" command sender; the pipeline was registered incompletely.',
    );
  }
  return (data) => sender.send(data);
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };
const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";

/**
 * A capability this deployment did not compose, reported to the caller.
 *
 * A handled error rather than a bare throw: the boundary serialises its code,
 * which is what a client keys its own copy off, and every one of these is a
 * DEPLOYMENT gap an operator can act on rather than a customer mistake.
 */
export class ApiEvaluationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiEvaluationUnavailableError";
  }
}
