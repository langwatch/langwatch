/**
 * The model gateway, composed over this process's own graph.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import {
  AwsStsManagedProviderCredentialAdapter,
  EnvironmentManagedProviderConfigurationAdapter,
  ManagedProviderConfigurationReporter,
  PostgresManagedProviderAdapter,
} from "@langwatch/enterprise-managed-provider-server";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  CodexOAuthModelProviderTokenRefresherAdapter,
  EncryptedModelProviderCredentialAdapter,
  HttpModelProviderCredentialProbeAdapter,
  ModelProviderManagedGatewayPort,
  ModelProviderRateLimitPort,
  PostgresModelProviderAdapter,
  PrefixedModelProviderIdAdapter,
  RegistryModelProviderCatalogAdapter,
  SsrfModelProviderEgressAdapter,
  VercelAiModelTranslationAdapter,
  WindowedModelProviderConnectionRateLimiterAdapter,
  type ModelProviderEgressPolicy,
} from "@langwatch/model-provider-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { HttpWorkflowNlpRuntimeAdapter } from "@langwatch/workflow-server";
import { nanoid } from "nanoid";
import type {
  ApiRateLimitRequest,
  ApiRateLimitResult,
} from "../platform/infrastructure/api-rate-limit.infrastructure";

/** Everything the model gateway is composed from. */
export type ApiModelProviderCompositionOptions = Readonly<{
  /** The one guarded connection every provider, default and cost row is read on. */
  prisma: PrismaClient;
  /** Resolves a project's team and organization, for scope derivation. */
  projects: ProjectService;
  /** Resolves an organization, for the organization-scoped provider rows. */
  organizations: OrganizationService;
  /** Decides who may read and write a provider row. */
  authorization: AuthzService;
  /**
   * The deployment's stored-secret cipher. Required: a gateway composed without one could not
   * read a single stored credential, and every provider would look configured-but-unusable. The
   * process gates on it rather than composing a gateway that answers nothing.
   */
  encryption: SecretEncryptionPort;
  /** The process's fixed-window counter, shared with every other metered path. */
  rateLimit: (request: ApiRateLimitRequest) => Promise<ApiRateLimitResult>;
  /** The process configuration a SYSTEM provider's credential is read from. */
  environment: Readonly<Record<string, string | undefined>>;
  /** Whether this is the hosted deployment; system providers exist only there. */
  isSaas: boolean;
  /**
   * The address policy a credential probe is fenced by, and whether its TLS is verified. The
   * deployment's, so it arrives whole from configuration: the metadata endpoints and the
   * cloud-provider domains are refused by the fence itself whatever this says.
   */
  egress: ModelProviderEgressPolicy;
  /**
   * Where the NLP engine answers, which is also where a resolved model is executed: the
   * OpenAI-compatible proxy hangs off it.
   */
  nlpServiceUrl: string | undefined;
  /** Names this process in a refusal a stand-in raises. */
  processName: string;
}>;

/** Composes the model gateway from this process's own graph. */
export function composeApiModelProviders(
  options: ApiModelProviderCompositionOptions,
): ModelProviderService {
  const logger = createLogger(options.processName);
  const managed = ApiManagedModelProviderGatewayAdapter.create({
    service: composeManagedProviders({
      projects: options.projects,
      environment: options.environment,
      logger,
    }),
  });

  return PostgresModelProviderAdapter.create({
    database: options.prisma,
    projects: options.projects,
    organizations: options.organizations,
    authorization: options.authorization,
    credentials: EncryptedModelProviderCredentialAdapter.create({ cipher: options.encryption }),
    codexTokenRefresher: CodexOAuthModelProviderTokenRefresherAdapter.create(),
    connectionRateLimiter: WindowedModelProviderConnectionRateLimiterAdapter.create({
      limiter: ApiModelProviderRateLimitAdapter.create({ consume: options.rateLimit }),
    }),
    catalog: RegistryModelProviderCatalogAdapter.create({
      managed,
      probe: HttpModelProviderCredentialProbeAdapter.create({
        egress: SsrfModelProviderEgressAdapter.create({ policy: options.egress }),
      }),
      systemProviderEnvironment: options.environment,
      isSaas: options.isSaas,
    }),
    translation: VercelAiModelTranslationAdapter.create({
      projects: options.projects,
      // The engine's address and the proxy's path, joined here: the path is
      // the WORKFLOW feature's (`/go/proxy/v1`, beside the dispatcher that
      // serves it) and the address is this process's configuration, and the
      // composition root is where two features meet.
      executionProxyBaseUrl: options.nlpServiceUrl
        ? HttpWorkflowNlpRuntimeAdapter.proxyBaseUrl({ baseUrl: options.nlpServiceUrl })
        : UNCONFIGURED_EXECUTION_PROXY,
      // No `codexHandles`: see the module docblock.
    }),
    ids: PrefixedModelProviderIdAdapter.create({ suffix: () => nanoid() }),
  }).build();
}

/**
 * The address a resolved model is executed against when no engine is configured.
 */
const UNCONFIGURED_EXECUTION_PROXY = "http://nlp-engine-not-configured.invalid";

/** Composes the Enterprise managed-provider service over this process's projects. */
function composeManagedProviders(input: {
  projects: ProjectService;
  environment: Readonly<Record<string, string | undefined>>;
  logger: Logger;
}): ManagedProviderService {
  return PostgresManagedProviderAdapter.create({
    projects: input.projects,
    configuration: EnvironmentManagedProviderConfigurationAdapter.create({
      source: input.environment,
      reporter: ApiManagedProviderConfigurationReporter.create(input.logger),
    }),
    credentials: AwsStsManagedProviderCredentialAdapter.create(),
  }).build();
}

/** Where the managed-provider configuration reader's own findings go. */
class ApiManagedProviderConfigurationReporter extends ManagedProviderConfigurationReporter {
  static create(logger: Logger): ApiManagedProviderConfigurationReporter {
    return new ApiManagedProviderConfigurationReporter(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  info(attributes: Record<string, unknown>, message: string): void {
    this.logger.info(attributes, message);
  }

  warn(attributes: Record<string, unknown>, message: string): void {
    this.logger.warn(attributes, message);
  }
}

/**
 * The two managed-provider answers the catalogue asks for, from the Enterprise service. A
 * narrow adapter rather than the service itself, because the model-provider package is not
 * Enterprise and may not name an Enterprise contract.
 */
class ApiManagedModelProviderGatewayAdapter extends ModelProviderManagedGatewayPort {
  static create(input: { service: ManagedProviderService }): ApiManagedModelProviderGatewayAdapter {
    return new ApiManagedModelProviderGatewayAdapter(input.service);
  }

  private constructor(private readonly service: ManagedProviderService) {
    super();
  }

  isManaged(input: { organizationId: string; provider: string }): boolean {
    return this.service.isManagedProvider(input);
  }

  prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    return this.service.buildLitellmParameters({
      params: input.parameters,
      projectId: input.projectId,
      model: input.model,
      modelProvider: { provider: input.provider },
    });
  }
}

/** The connection-test windows, counted where this process counts everything else. */
class ApiModelProviderRateLimitAdapter extends ModelProviderRateLimitPort {
  static create(input: {
    consume: (request: ApiRateLimitRequest) => Promise<ApiRateLimitResult>;
  }): ApiModelProviderRateLimitAdapter {
    return new ApiModelProviderRateLimitAdapter(input.consume);
  }

  private constructor(
    private readonly consumeWindow: (request: ApiRateLimitRequest) => Promise<ApiRateLimitResult>,
  ) {
    super();
  }

  async consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }> {
    const result = await this.consumeWindow(input);
    return { allowed: result.allowed, resetAt: result.resetAt };
  }
}

/**
 * Names which precondition a model gateway is missing, so an operator reading "no workflow
 * surfaces" can tell a deployment that has no database from one whose tenancy graph never
 * composed.
 */
export class LoggedApiModelProviderAbsence {
  static create(logger: Pick<Logger, "info">): LoggedApiModelProviderAbsence {
    return new LoggedApiModelProviderAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {}

  absent(reason: "no-database" | "no-tenancy" | "no-encryption"): void {
    this.logger.info(
      { reason },
      "API composed no model gateway: it serves no workflow, optimization, experiment or evaluation surfaces, and no model provider can be read or written.",
    );
  }
}
