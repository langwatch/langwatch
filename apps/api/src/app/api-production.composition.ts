import type { AgentService } from "@langwatch/agent-contract";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import { createLogger } from "@langwatch/observability";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { SecretService } from "@langwatch/secret-contract";
import {
  ApiAuditPort,
  ApiRequestPolicy,
  AuthzApiAuthorizationAdapter,
} from "../api-request.policy";
import { ApiFeatureDrainPort, ApiProcess } from "../api.process";
import { ApiMetricsPort, ApiReadinessPort } from "../api-process.lifecycle";
import { ApiQueueInfrastructure } from "../platform/infrastructure/api-queue.infrastructure";
import {
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main";
import { ApiSecretRestFeature } from "../api-secret-rest.feature";
import type { ApiRestSecurityPort } from "../api-rest.security";
import {
  ApiAuthSessionCompositionPort,
  AuthSessionApiAuthenticationAdapter,
} from "./api-auth.composition";
import { ApiKeyRestSecurityAdapter } from "./api-key-rest-security.adapter";

/** The concrete composition port for the migrated API transports. */
export class ApiProductionComposition extends ApiRuntimeCompositionPort {
  static create(options: {
    agents: AgentService;
    secrets: SecretService;
    apiKeys: ApiKeyService;
    authz: AuthzService;
    auth: ApiAuthSessionCompositionPort;
    audit?: ApiAuditPort;
    readiness?: ApiReadinessPort;
    metrics?: ApiMetricsPort;
    featureDrain?: ApiFeatureDrainPort;
    queueStorage?: GroupQueueStoragePort;
  }): ApiProductionComposition {
    const policy = ApiRequestPolicy.create({
      authentication: AuthSessionApiAuthenticationAdapter.create(options.auth.compose()),
      authorization: AuthzApiAuthorizationAdapter.create(options.authz),
      audit: options.audit,
    });
    const restSecurity = ApiKeyRestSecurityAdapter.create({
      apiKeys: options.apiKeys,
      authz: options.authz,
      audit: options.audit,
    });
    return new ApiProductionComposition(
      options.agents,
      options.secrets,
      policy,
      restSecurity,
      options.readiness,
      options.metrics,
      options.featureDrain,
      options.queueStorage,
    );
  }

  private constructor(
    private readonly agents: AgentService,
    private readonly secrets: SecretService,
    readonly policy: ApiRequestPolicy,
    private readonly restSecurity: ApiRestSecurityPort,
    private readonly readiness: ApiReadinessPort | undefined,
    private readonly metrics: ApiMetricsPort | undefined,
    private readonly featureDrain: ApiFeatureDrainPort | undefined,
    private readonly queueStorage: GroupQueueStoragePort | undefined,
  ) {
    super();
  }

  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    const queueInfrastructure = ApiQueueInfrastructure.create({
      resources: options.resources,
      redis: options.config.infrastructure.redis,
      redisLogger: createLogger(options.config.serviceName),
      queuePolicy: options.config.infrastructure.groupQueue,
      storage: this.queueStorage,
    });
    const process = ApiProcess.create({
      agents: this.agents,
      secrets: this.secrets,
      requestPolicy: this.policy,
      rest: ApiSecretRestFeature.create({
        secrets: this.secrets,
        security: this.restSecurity,
      }),
      observability: options.observability,
      graph: options.graph,
      featureDrain: this.featureDrain,
      readiness: this.readiness ?? queueInfrastructure.readiness,
      metrics: this.metrics,
      listener: {
        host: options.config.host,
        port: options.config.port,
        drainGraceMs: options.config.httpDrainGraceMs,
      },
    });

    return Promise.resolve(ApiProductionProcess.create(process));
  }
}

/** The real listener/process whose close sequence owns graph and telemetry shutdown. */
class ApiProductionProcess extends ApiRuntimeProcessPort {
  static create(process: ApiProcess): ApiProductionProcess {
    return new ApiProductionProcess(process);
  }

  private constructor(private readonly process: ApiProcess) {
    super();
  }

  start(): Promise<{ host: string; port: number } | undefined> {
    return this.process.start();
  }

  close(): Promise<void> {
    return this.process.close();
  }
}
