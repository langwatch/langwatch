import {
  createProcessObservability,
  type ProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import type { AgentApi } from "@langwatch/agent-contract";
import type { TRPCCreateRouterOptions } from "@trpc/server";
import {
  ApiApplication,
  NoApiTrpcFeatures,
  type ApiHttpOptions,
  type ApiSubscriptionMount,
  type ApiTrpcFeatures,
} from "./api.application.ts";
import { ApiHttpListener, type ApiHttpListenerOptions } from "./api-http.listener.ts";
import {
  ApiMetrics,
  ApiProcessLifecycleRoutes,
  ApiReadiness,
  ObservabilityApiRequestFailureCaptureAdapter,
} from "./api-process.lifecycle.ts";
import { ApiRequestPolicy } from "./api-request.policy.ts";
import { GracefulShutdown, type ShutdownLogger } from "@langwatch/runtime-composition";
import type { Hono } from "hono";
import { trace } from "@opentelemetry/api";

/** Resources backing the composed service graph, closed after telemetry flushes. */
export abstract class ApiProcessGraph {
  /**
   * Stops feature-owned intake and drains work that still needs infrastructure.
   * Implementations without feature work intentionally inherit the no-op.
   */
  async drain(): Promise<void> {}

  abstract close(): Promise<void>;
}

/**
 * Boot boundary for a standalone API listener. The host owns socket binding; this process
 * object owns the finalization sequence.
 */
export class ApiProcess {
  static create(options: {
    agents: AgentApi;
    http?: Omit<ApiHttpOptions, "logger">;
    requestPolicy?: ApiRequestPolicy;
    rest?: Hono;
    /**
     * The subscription lane, when this process serves one. Separate from
     * `rest` because it is not a REST family: it needs the tRPC caller only
     * the application holds, so it is handed the ports rather than built here.
     */
    subscriptions?: ApiSubscriptionMount;
    observability: ProcessObservabilityOptions;
    listener?: Omit<ApiHttpListenerOptions, "application" | "logger">;
    graph?: ApiProcessGraph;
    featureDrain?: ApiFeatureDrain;
    readiness?: ApiReadiness;
    metrics?: ApiMetrics;
    /**
     * The packaged tRPC namespaces, when this process composed them.
     */
    features?: ApiTrpcFeatures<TRPCCreateRouterOptions>;
    /**
     * Whether every mounted tRPC procedure's answer is checked against the
     * output schema it declares. Resolved once from configuration by the
     * composition root and handed down; nothing below reads an environment.
     */
    validateOutput?: boolean;
  }): ApiProcess {
    if (options.http && options.requestPolicy) {
      throw new Error("API process composition accepts HTTP options or request policy, not both.");
    }

    const http = options.http ?? options.requestPolicy?.asHttpOptions();
    if (!http) {
      throw new Error("API process composition requires request policy or HTTP context options.");
    }
    const observability = createProcessObservability(options.observability);
    const application = ApiApplication.create({
      agents: options.agents,
      features: options.features ?? new NoApiTrpcFeatures(),
      validateOutput: options.validateOutput ?? false,
      http: {
        ...http,
        ...(options.subscriptions ? { subscriptions: options.subscriptions } : {}),
        logger: observability.logger,
        errorCapture:
          http.errorCapture ??
          ObservabilityApiRequestFailureCaptureAdapter.create({
            logger: observability.logger,
            tracer: trace.getTracer(options.observability.serviceName),
          }),
      },
      rest: ApiProcessLifecycleRoutes.create({ metrics: options.metrics, rest: options.rest }),
    });
    const hono = application.hono;
    const listener = options.listener
      ? ApiHttpListener.create({
          ...options.listener,
          application: requireHono(hono),
          logger: observability.logger,
        })
      : undefined;
    return new ApiProcess(
      application,
      observability,
      listener,
      options.graph,
      options.featureDrain,
      options.readiness,
    );
  }

  private closing: Promise<void> | undefined;

  private constructor(
    /**
     * Widened to the record BOUND rather than this process's own instantiation: a
     * deployment that composed no packaged surfaces holds an application over an empty
     * record, and a process type that named only the full one could not hold it.
     */
    readonly application: ApiApplication<TRPCCreateRouterOptions>,
    private readonly observability: ProcessObservability,
    private readonly listener: ApiHttpListener | undefined,
    private readonly graph: ApiProcessGraph | undefined,
    private readonly featureDrain: ApiFeatureDrain | undefined,
    private readonly readiness: ApiReadiness | undefined,
  ) {}

  async start(): Promise<{ host: string; port: number } | undefined> {
    await this.readiness?.assertReady();
    return this.listener ? this.listener.start() : undefined;
  }

  close(): Promise<void> {
    this.closing ??= this.closeProcess();
    return this.closing;
  }

  private closeProcess(): Promise<void> {
    return closeApiProcessResources({
      listener: this.listener,
      featureDrain: this.featureDrain,
      graph: this.graph,
      observability: this.observability,
      logger: this.observability.logger,
    });
  }
}

/**
 * The one API finalization order, shared by every process shape. Intake stops first, then
 * feature work drains, then telemetry flushes while request diagnostics still exist, and
 * only then are infrastructure resources released.
 */
export async function closeApiProcessResources(options: {
  listener?: (Pick<ApiHttpListener, "close"> & { closePhaseTimeoutMs?: number }) | undefined;
  featureDrain?: ApiFeatureDrain | undefined;
  graph?: ApiProcessGraph | undefined;
  observability: Pick<ProcessObservability, "shutdown">;
  logger?: ShutdownLogger;
}): Promise<void> {
  // The drain phases legitimately outlast the runner's default ceiling — a
  // queue drain is entitled to the whole budget — so they carry a backstop
  // above any pod grace period rather than the ten seconds a teardown gets.
  const drain = DRAIN_PHASE_TIMEOUT_MS;
  const shutdown = GracefulShutdown.create({ logger: options.logger ?? SILENT_SHUTDOWN_LOGGER })
    .phase({
      name: "http-listener",
      // The listener's own ceiling, which sits above the grace it hands out,
      // so the runner never abandons the phase before the reap it leads into.
      ...(options.listener?.closePhaseTimeoutMs
        ? { timeoutMs: options.listener.closePhaseTimeoutMs }
        : {}),
      run: async () => void (await options.listener?.close()),
    })
    .phase({
      name: "feature-drain",
      timeoutMs: drain,
      run: async () => void (await options.featureDrain?.drain()),
    })
    .phase({
      name: "graph-drain",
      timeoutMs: drain,
      run: async () => void (await options.graph?.drain()),
    })
    // Telemetry flushes while the request diagnostics it describes still
    // exist, and it is a phase this composition adds rather than something a
    // provider registers into the runner behind its back.
    .phase({
      name: "telemetry",
      timeoutMs: drain,
      run: async () => void (await options.observability.shutdown()),
    })
    .phase({
      name: "graph-close",
      timeoutMs: drain,
      run: async () => void (await options.graph?.close()),
    });

  const firstError = await shutdown.run();
  if (firstError) throw firstError;
}

/**
 * A process that composed no logger still runs the phases; it just cannot say
 * which one failed. The error it throws carries that anyway.
 */
const DRAIN_PHASE_TIMEOUT_MS = 60_000;

const SILENT_SHUTDOWN_LOGGER: ShutdownLogger = {
  info: () => void 0,
  error: () => void 0,
};

/** Feature-owned shutdown work that must finish before telemetry and infrastructure close. */
export abstract class ApiFeatureDrain {
  abstract drain(): Promise<void>;
}

function requireHono(hono: ApiApplication["hono"]) {
  if (!hono) {
    throw new Error("An API HTTP listener requires HTTP request policy at process composition.");
  }
  return hono;
}
