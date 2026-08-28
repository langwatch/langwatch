import type { AgentService } from "@langwatch/agent-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { ApiAuditPort, ApiAuthorizationPort, ApiRequestPolicy } from "../api-request.policy";
import { ApiProcess } from "../api.process";
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

/** The concrete composition port for the migrated API transports. */
export class ApiProductionComposition extends ApiRuntimeCompositionPort {
  static create(options: {
    agents: AgentService;
    secrets: SecretService;
    auth: ApiAuthSessionCompositionPort;
    authorization: ApiAuthorizationPort;
    restSecurity: ApiRestSecurityPort;
    audit?: ApiAuditPort;
  }): ApiProductionComposition {
    const policy = ApiRequestPolicy.create({
      authentication: AuthSessionApiAuthenticationAdapter.create(options.auth.compose()),
      authorization: options.authorization,
      audit: options.audit,
    });
    return new ApiProductionComposition(
      options.agents,
      options.secrets,
      policy,
      options.restSecurity,
    );
  }

  private constructor(
    private readonly agents: AgentService,
    private readonly secrets: SecretService,
    readonly policy: ApiRequestPolicy,
    private readonly restSecurity: ApiRestSecurityPort,
  ) {
    super();
  }

  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
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
