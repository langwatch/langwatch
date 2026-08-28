import {
  createProcessObservability,
  type ProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import type { AgentService } from "@langwatch/agent-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { ApiApplication, type ApiHttpOptions } from "./api.application";

/**
 * Boot boundary for a standalone API listener. The host owns socket binding;
 * this process object owns the one logger/tracer provider and its final flush.
 */
export class ApiProcess {
  static create(options: {
    agents: AgentService;
    secrets: SecretService;
    http: Omit<ApiHttpOptions, "logger">;
    observability: ProcessObservabilityOptions;
  }): ApiProcess {
    const observability = createProcessObservability(options.observability);
    const application = ApiApplication.create({
      agents: options.agents,
      secrets: options.secrets,
      http: { ...options.http, logger: observability.logger },
    });
    return new ApiProcess(application, observability);
  }

  private closing: Promise<void> | undefined;

  private constructor(
    readonly application: ApiApplication,
    private readonly observability: ProcessObservability,
  ) {}

  close(): Promise<void> {
    this.closing ??= this.observability.shutdown();
    return this.closing;
  }
}
