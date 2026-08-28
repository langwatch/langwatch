import {
  createProcessObservability,
  type ProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import type { AgentService } from "@langwatch/agent-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { ApiApplication, type ApiHttpOptions } from "./api.application";
import { ApiHttpListener, type ApiHttpListenerOptions } from "./api-http.listener";
import {
  ApiMetricsPort,
  ApiProcessLifecycleRoutes,
  ApiReadinessPort,
  ObservabilityApiRequestFailureCaptureAdapter,
} from "./api-process.lifecycle";
import { ApiRequestPolicy } from "./api-request.policy";
import type { Hono } from "hono";
import { trace } from "@opentelemetry/api";

/** Resources backing the composed service graph, closed after telemetry flushes. */
export abstract class ApiProcessGraphPort {
  /**
   * Stops feature-owned intake and drains work that still needs infrastructure.
   * Implementations without feature work intentionally inherit the no-op.
   */
  async drain(): Promise<void> {}

  abstract close(): Promise<void>;
}

/**
 * Boot boundary for a standalone API listener. The host owns socket binding;
 * this process object owns the finalization sequence. Intake drains first,
 * then telemetry flushes while request diagnostics are still available, and
 * only then are database and network resources released.
 */
export class ApiProcess {
  static create(options: {
    agents: AgentService;
    secrets: SecretService;
    http?: Omit<ApiHttpOptions, "logger">;
    requestPolicy?: ApiRequestPolicy;
    rest?: Hono;
    observability: ProcessObservabilityOptions;
    listener?: Omit<ApiHttpListenerOptions, "application" | "logger">;
    graph?: ApiProcessGraphPort;
    featureDrain?: ApiFeatureDrainPort;
    readiness?: ApiReadinessPort;
    metrics?: ApiMetricsPort;
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
      secrets: options.secrets,
      http: {
        ...http,
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
    readonly application: ApiApplication,
    private readonly observability: ProcessObservability,
    private readonly listener: ApiHttpListener | undefined,
    private readonly graph: ApiProcessGraphPort | undefined,
    private readonly featureDrain: ApiFeatureDrainPort | undefined,
    private readonly readiness: ApiReadinessPort | undefined,
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
    });
  }
}

/**
 * The one API finalization order, shared by every process shape.
 *
 * Intake stops first, then feature work drains, then telemetry flushes while
 * request diagnostics still exist, and only then are infrastructure resources
 * released. Every phase runs even after an earlier one fails, and the first
 * failure is the one reported.
 */
export async function closeApiProcessResources(options: {
  listener?: Pick<ApiHttpListener, "close"> | undefined;
  featureDrain?: ApiFeatureDrainPort | undefined;
  graph?: ApiProcessGraphPort | undefined;
  observability: Pick<ProcessObservability, "shutdown">;
}): Promise<void> {
  let firstError: unknown;
  const phases: Array<() => Promise<void> | undefined> = [
    () => options.listener?.close(),
    () => options.featureDrain?.drain(),
    () => options.graph?.drain(),
    () => options.observability.shutdown(),
    () => options.graph?.close(),
  ];

  for (const phase of phases) {
    try {
      await phase();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

/** Feature-owned shutdown work that must finish before telemetry and infrastructure close. */
export abstract class ApiFeatureDrainPort {
  abstract drain(): Promise<void>;
}

function requireHono(hono: ApiApplication["hono"]) {
  if (!hono) {
    throw new Error("An API HTTP listener requires HTTP request policy at process composition.");
  }
  return hono;
}
