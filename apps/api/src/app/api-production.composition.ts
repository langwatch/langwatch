import type { AgentService } from "@langwatch/agent-contract";
import type { SecretService } from "@langwatch/secret-contract";
import type { ProcessObservabilityOptions } from "@langwatch/observability/node";
import {
  ApiAuditPort,
  ApiAuthenticationPort,
  ApiAuthorizationPort,
  ApiRequestPolicy,
} from "../api-request.policy";
import { ApiProcess } from "../api.process";
import { ApiSecretRestFeature } from "../api-secret-rest.feature";
import type { ApiRestSecurityPort } from "../api-rest.security";
import type { ApiConfig } from "../platform/config/api.config";

/** The directly runnable API graph for feature-owned transports. */
export class ApiProductionComposition {
  static create(options: {
    config: ApiConfig;
    agents: AgentService;
    secrets: SecretService;
    authentication: ApiAuthenticationPort;
    authorization: ApiAuthorizationPort;
    restSecurity: ApiRestSecurityPort;
    audit?: ApiAuditPort;
    observability: ProcessObservabilityOptions;
  }): ApiProductionComposition {
    const policy = ApiRequestPolicy.create({
      authentication: options.authentication,
      authorization: options.authorization,
      audit: options.audit,
    });
    const process = ApiProcess.create({
      agents: options.agents,
      secrets: options.secrets,
      requestPolicy: policy,
      rest: ApiSecretRestFeature.create({
        secrets: options.secrets,
        security: options.restSecurity,
      }),
      observability: options.observability,
      listener: {
        host: options.config.host,
        port: options.config.port,
        drainGraceMs: options.config.httpDrainGraceMs,
      },
    });

    return new ApiProductionComposition(process, policy);
  }

  private constructor(
    readonly process: ApiProcess,
    readonly policy: ApiRequestPolicy,
  ) {}

  start(): Promise<{ host: string; port: number } | undefined> {
    return this.process.start();
  }

  close(): Promise<void> {
    return this.process.close();
  }
}
