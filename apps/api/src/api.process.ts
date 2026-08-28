import {
  createProcessObservability,
  type ProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import type { AgentService } from "@langwatch/agent-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { ApiApplication, type ApiHttpOptions } from "./api.application";
import { ApiHttpListener, type ApiHttpListenerOptions } from "./api-http.listener";
import { ApiRequestPolicy } from "./api-request.policy";
import type { Hono } from "hono";

/**
 * Boot boundary for a standalone API listener. The host owns socket binding;
 * this process object owns the one logger/tracer provider and its final flush.
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
      http: { ...http, logger: observability.logger },
      rest: options.rest,
    });
    const hono = application.hono;
    const listener = options.listener
      ? ApiHttpListener.create({
          ...options.listener,
          application: requireHono(hono),
          logger: observability.logger,
        })
      : undefined;
    return new ApiProcess(application, observability, listener);
  }

  private closing: Promise<void> | undefined;

  private constructor(
    readonly application: ApiApplication,
    private readonly observability: ProcessObservability,
    private readonly listener: ApiHttpListener | undefined,
  ) {}

  start(): Promise<{ host: string; port: number } | undefined> {
    return this.listener ? this.listener.start() : Promise.resolve(undefined);
  }

  close(): Promise<void> {
    this.closing ??= this.closeProcess();
    return this.closing;
  }

  private async closeProcess(): Promise<void> {
    let firstError: unknown;
    try {
      await this.listener?.close();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.observability.shutdown();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }
}

function requireHono(hono: ApiApplication["hono"]) {
  if (!hono) {
    throw new Error("An API HTTP listener requires HTTP request policy at process composition.");
  }
  return hono;
}
