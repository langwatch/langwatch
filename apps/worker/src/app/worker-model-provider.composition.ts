/**
 * The model gateway, composed over this process's own graph.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { HttpWorkflowNlpRuntimeAdapter } from "@langwatch/workflow-server";
import {
  HttpManagedProviderCredentialsChannel,
  ManagedProviderConfigurationService,
  ManagedProviderConfigurationReporter,
  ManagedProviderService as EnterpriseManagedProviderService,
} from "@langwatch/enterprise-managed-provider-server";
import type { ManagedProviderApi } from "@langwatch/enterprise-managed-provider-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import {
  CodexAccountService,
  CodexOAuthModelProviderTokenRefresherAdapter,
  EncryptedModelProviderCredentialAdapter,
  HttpModelProviderCredentialProbeAdapter,
  ModelProviderManagedGateway,
  ModelProviderRateLimit,
  ModelTranslation,
  PostgresModelProviderAdapter,
  PrefixedModelProviderIdAdapter,
  RegistryModelProviderCatalogAdapter,
  SsrfModelProviderEgressAdapter,
  VercelAiModelTranslationAdapter,
  WindowedModelProviderConnectionRateLimiterAdapter,
  type ModelProviderCredentialCipher,
  type ModelProviderCredentialCodec,
  type ModelProviderInfrastructure,
  type PostgresModelProviderAdapterOptions,
} from "@langwatch/model-provider-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { nowInstant } from "@langwatch/time";

/**
 * Reports the two composition decisions the model gateway would otherwise hide.
 */
export abstract class WorkerModelProviderAbsenceReport {
  /**
   * Why this process composed no gateway AT ALL, when it composed none.
   */
  abstract withoutModelGateway(reason: "no-encryption" | "no-tenancy"): void;

  /** The translation surface, which needs an execution proxy this process does not join. */
  abstract withoutModelTranslation(): void;

  /**
   * Reported when this deployment configured no Redis: the connection-test
   * windows are shared counters, and a process that counted them in memory
   * would hand out a second budget beside the one the other tier is spending.
   */
  abstract withoutConnectionWindows(): void;
}

export type WorkerModelProviderCompositionOptions = Readonly<{
  /**
   * The one guarded connection every provider, default and cost row is read on.
   */
  database: PostgresModelProviderAdapterOptions["database"];
  /** Resolves a project's team and organization, for scope derivation. */
  projects: ProjectApi;
  /** Resolves an organization, for the organization-scoped provider rows. */
  organizations: OrganizationApi;
  /** Decides who may read and write a provider row. */
  authorization: AuthzApi;
  /**
   * The deployment's stored-secret cipher. Required rather than optional: a gateway composed
   * without one could not read a single stored credential, and every provider would look
   * configured-but-unusable.
   */
  encryption: ModelProviderCredentialCipher;
  config: WorkerConfig;
  /** The queue's own Redis, or nothing on a deployment that configured none. */
  redis?: RedisConnection | null;
  absence?: WorkerModelProviderAbsenceReport;
}>;

/**
 * The model gateway and the managed-provider service behind it.
 */
export type WorkerModelProviders = Readonly<{
  modelProviders: ModelProviderApi;
  managedProviders: ManagedProviderApi;
  /**
   * What the installed model-provider module is built over in this same
   * process: the deployment's credential cipher, which travels with the
   * connection because a stored credential is a wire format, and the technical
   * answers the module asks for. Stated once, so the gateway above and the
   * installed module cannot be composed from two different registries.
   */
  installation: Readonly<{
    credentials: ModelProviderCredentialCodec;
    infrastructure: Omit<ModelProviderInfrastructure, "spans">;
  }>;
}>;

/**
 * The tenancy graph a provider row's scope is derived from. One value rather than three options
 * because it IS one graph: the project service resolves a project's organization through the
 * organization service, and the permission service answers for both.
 */
export type WorkerModelProviderTenancy = Readonly<{
  projects: ProjectApi;
  organizations: OrganizationApi;
  authorization: AuthzApi;
}>;

/**
 * Composes the gateway only when this process has everything it needs to answer correctly, and
 * says which precondition was missing when it does not.
 */
export function tryCreateWorkerModelProviders(
  options: Omit<
    WorkerModelProviderCompositionOptions,
    "encryption" | "projects" | "organizations" | "authorization"
  > & {
    encryption: ModelProviderCredentialCipher | undefined;
    tenancy: WorkerModelProviderTenancy | undefined;
  },
): WorkerModelProviders | undefined {
  if (!options.encryption) {
    options.absence?.withoutModelGateway("no-encryption");
    return undefined;
  }
  if (!options.tenancy) {
    options.absence?.withoutModelGateway("no-tenancy");
    return undefined;
  }

  return createWorkerModelProviders({
    ...options,
    encryption: options.encryption,
    projects: options.tenancy.projects,
    organizations: options.tenancy.organizations,
    authorization: options.tenancy.authorization,
  });
}

/** Composes the model gateway from this process's own graph. */
export function createWorkerModelProviders(
  options: WorkerModelProviderCompositionOptions,
): WorkerModelProviders {
  const logger = createLogger(options.config.serviceName);
  const managedProviders = composeWorkerManagedProviders({
    projects: options.projects,
    environment: options.config.infrastructure.modelProvider.environment,
    logger,
  });

  // The engine's address plus the proxy path, joined here because the path is
  // the WORKFLOW feature's and the address is the deployment's — one join, made
  // once per process, so a translation and a Langy title call cannot reach two
  // different proxies.
  const nlpServiceUrl = options.config.infrastructure.modelProvider.nlpServiceUrl;
  const executionProxyBaseUrl = nlpServiceUrl
    ? HttpWorkflowNlpRuntimeAdapter.proxyBaseUrl({ baseUrl: nlpServiceUrl })
    : undefined;
  if (!executionProxyBaseUrl) options.absence?.withoutModelTranslation();
  if (!options.redis) options.absence?.withoutConnectionWindows();

  const credentials = EncryptedModelProviderCredentialAdapter.create({
    cipher: options.encryption,
  });
  const credentialProbe = HttpModelProviderCredentialProbeAdapter.create({
    egress: SsrfModelProviderEgressAdapter.create({
      policy: {
        blockLocal: options.config.infrastructure.modelProvider.blockLocalHttpCalls,
        allowedHosts: options.config.infrastructure.modelProvider.allowedProxyHosts,
        // Tied to the hosted flag rather than to the address policy, the same
        // join the webhook sender makes: an on-prem install calling a service
        // with a self-signed certificate is a different question from whether
        // private addresses are reachable.
        verifyTls: options.config.deployment.saas,
      },
    }),
  });
  const technical = {
    codexTokenRefresher: CodexOAuthModelProviderTokenRefresherAdapter.create(),
    connectionRateLimiter: WindowedModelProviderConnectionRateLimiterAdapter.create({
      limiter: options.redis
        ? new WorkerModelProviderRateLimit(options.redis)
        : new AbsentWorkerModelProviderRateLimit(),
    }),
    catalog: RegistryModelProviderCatalogAdapter.create({
      managed: WorkerManagedModelProviderGatewayAdapter.create({ service: managedProviders }),
      probe: credentialProbe,
      systemProviderEnvironment: options.config.infrastructure.modelProvider.environment,
      isSaas: options.config.deployment.saas,
    }),
    translation: executionProxyBaseUrl
      ? VercelAiModelTranslationAdapter.create({
          projects: options.projects,
          executionProxyBaseUrl,
        })
      : new AbsentWorkerModelTranslation(),
    ids: PrefixedModelProviderIdAdapter.create({ suffix: () => nanoid() }),
  };

  const modelProviders = PostgresModelProviderAdapter.create({
    database: options.database,
    projects: options.projects,
    organizations: options.organizations,
    authorization: options.authorization,
    credentials,
    ...technical,
  }).build();

  return {
    modelProviders,
    managedProviders,
    installation: {
      credentials,
      infrastructure: { ...technical, credentialProbe, codexAccounts: new CodexAccountService() },
    },
  };
}

/** Composes the Enterprise managed-provider service over this process's projects. */
function composeWorkerManagedProviders(input: {
  projects: ProjectApi;
  environment: Readonly<Record<string, string | undefined>>;
  logger: Logger;
}): ManagedProviderApi {
  return EnterpriseManagedProviderService.create({
    projects: input.projects,
    configuration: ManagedProviderConfigurationService.create({
      source: input.environment,
      reporter: WorkerManagedProviderConfigurationReporter.create(input.logger),
    }),
    credentials: HttpManagedProviderCredentialsChannel.create(),
  });
}

/** Where the managed-provider configuration reader's own findings go. */
class WorkerManagedProviderConfigurationReporter extends ManagedProviderConfigurationReporter {
  static create(logger: Logger): WorkerManagedProviderConfigurationReporter {
    return new WorkerManagedProviderConfigurationReporter(logger);
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
class WorkerManagedModelProviderGatewayAdapter extends ModelProviderManagedGateway {
  static create(input: {
    service: ManagedProviderApi;
  }): WorkerManagedModelProviderGatewayAdapter {
    return new WorkerManagedModelProviderGatewayAdapter(input.service);
  }

  private constructor(private readonly service: ManagedProviderApi) {
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

/**
 * The connection-test windows, counted where this process counts every other shared ceiling.
 */
class WorkerModelProviderRateLimit extends ModelProviderRateLimit {
  constructor(private readonly connection: RedisConnection) {
    super();
  }

  async consume({
    key,
    windowSeconds,
    max,
  }: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }> {
    const now = nowInstant().epochMilliseconds;
    const redisKey = `langwatch:ratelimit:${key}`;
    const count = await this.connection.incr(redisKey);
    if (count === 1) {
      await this.connection.expire(redisKey, windowSeconds);
    }
    const ttl = await this.connection.ttl(redisKey);

    return {
      allowed: count <= max,
      resetAt: now + (ttl > 0 ? ttl : windowSeconds) * 1000,
    };
  }
}

/**
 * The window a deployment with no Redis cannot count. It refuses rather than allowing.
 */
class AbsentWorkerModelProviderRateLimit extends ModelProviderRateLimit {
  consume(input: { key: string; windowSeconds: number; max: number }): Promise<never> {
    return Promise.reject(new WorkerConnectionWindowUnavailableError(input.key));
  }
}

/** Named so a refused connection test reads as a composition decision. */
export class WorkerConnectionWindowUnavailableError extends Error {
  readonly name = "WorkerConnectionWindowUnavailableError";

  constructor(key: string) {
    super(
      `This process cannot count the connection-test window ${key}: the window is a shared budget and this deployment configured no Redis to count it in.`,
    );
  }
}

/**
 * Translating a customer's text, where the deployment named no NLP engine. A translation is a
 * MODEL CALL executed against the OpenAI-compatible proxy that hangs off the engine's address,
 * and `LANGWATCH_NLP_SERVICE` is what names it.
 */
class AbsentWorkerModelTranslation extends ModelTranslation {
  translate(input: { projectId: string; text: string; model: string }): Promise<never> {
    return Promise.reject(new WorkerModelTranslationUnavailableError(input.projectId));
  }
}

/** Named so a refused translation reads as a composition decision. */
export class WorkerModelTranslationUnavailableError extends Error {
  readonly name = "WorkerModelTranslationUnavailableError";

  constructor(projectId: string) {
    super(
      `This process cannot translate for project ${projectId}: a translation executes against the NLP engine's OpenAI-compatible proxy, and this deployment named no LANGWATCH_NLP_SERVICE.`,
    );
  }
}
