/**
 * The model gateway, composed over this process's own graph.
 *
 * `ModelProviderService` is the capability BOTH of this process's model-using
 * paths resolve through — topic clustering's four model questions and an
 * online evaluation's `X_LITELLM_*` environment — and until this module
 * existed neither could be answered: `TopicClusteringModelsPort` refused by
 * name and `EvaluationModelEnvPort` had no service to take. It is composed
 * ONCE here and handed to both, because two gateways would be two decryptions
 * of the same stored credential and two answers to "which model does this
 * project cluster with".
 *
 * The six ports `PostgresModelProviderAdapter` asks of a composition root,
 * answered here the way `apps/api/src/app/api-model-provider.composition.ts`
 * answers them:
 *
 *   credentials      the deployment's stored-secret cipher — the SAME key
 *                    `CREDENTIALS_SECRET`/`NEXTAUTH_SECRET` that both halves
 *                    of Automation and the gateway's endpoint secrets already
 *                    run under, so a credential written by the API tier
 *                    decrypts here.
 *   catalog          the packaged registry plus three facts that are the
 *                    DEPLOYMENT's: whether it is the hosted install, which
 *                    system providers it credentials, and the fence an
 *                    outbound credential probe is judged by.
 *   connectionRateLimiter  the connection-test windows, counted in the one
 *                    Redis this process already holds — the same keyspace and
 *                    the same key prefix the other tier counts in.
 *   codexTokenRefresher  the packaged OAuth device-flow refresher.
 *   ids              the feature's three row prefixes over `nanoid`, the same
 *                    minter the API tier writes rows with.
 *   translation      the packaged Vercel AI adapter over the execution proxy,
 *                    or ABSENT where the deployment named no NLP engine.
 *
 * The tenancy graph is NOT composed here. `projects`, `organizations` and
 * `authorization` arrive as arguments for the same reason they do on the API
 * tier: they are one graph the process composes once, and a gateway built over
 * its own copy would resolve a project's scopes from a different read than the
 * one everything else in the process uses.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import { nlpProxyBaseUrl } from "@langwatch/workflow-server";
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
  ModelTranslationPort,
  PostgresModelProviderAdapter,
  PrefixedModelProviderIdAdapter,
  RegistryModelProviderCatalogAdapter,
  SsrfModelProviderEgressAdapter,
  VercelAiModelTranslationAdapter,
  WindowedModelProviderConnectionRateLimiterAdapter,
  type ModelProviderCredentialCipherPort,
  type PostgresModelProviderAdapterOptions,
} from "@langwatch/model-provider-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import type { WorkerConfig } from "../platform/config/worker.config";

/**
 * Reports the two composition decisions the model gateway would otherwise
 * hide.
 *
 * Both are stated at boot rather than inferred from a call that always throws:
 * the gateway is composed either way and every model a customer configured
 * resolves through it, so what these name is the two surfaces it does not
 * serve.
 */
export abstract class WorkerModelProviderAbsenceReportPort {
  /**
   * Why this process composed no gateway AT ALL, when it composed none.
   *
   * Two things can leave it absent and they are told apart, because the
   * consequence is one an operator has to act on differently: `no-encryption`
   * is a deployment that never set `CREDENTIALS_SECRET`, and `no-tenancy` is
   * this process not yet composing the project, organization and permission
   * graph a provider row's scope is derived from. Without this line, a stalled
   * clustering schedule and an evaluation that cannot resolve a model look
   * identical to a deployment that simply configured no providers.
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
   * The one guarded connection every provider, default and cost row is read
   * on.
   *
   * Typed as the packaged adapter's own database option rather than restated:
   * the three repositories behind it each narrow the client to the delegates
   * they use and refuse by name at construction when one is missing, so a
   * shape declared a second time here would be a second description of the
   * same requirement.
   */
  database: PostgresModelProviderAdapterOptions["database"];
  /** Resolves a project's team and organization, for scope derivation. */
  projects: ProjectService;
  /** Resolves an organization, for the organization-scoped provider rows. */
  organizations: OrganizationService;
  /** Decides who may read and write a provider row. */
  authorization: AuthzService;
  /**
   * The deployment's stored-secret cipher.
   *
   * Required rather than optional: a gateway composed without one could not
   * read a single stored credential, and every provider would look
   * configured-but-unusable. The caller gates on it rather than composing a
   * gateway that answers nothing.
   */
  encryption: ModelProviderCredentialCipherPort;
  config: WorkerConfig;
  /** The queue's own Redis, or nothing on a deployment that configured none. */
  redis?: RedisConnection | null;
  absence?: WorkerModelProviderAbsenceReportPort;
}>;

/**
 * The model gateway and the managed-provider service behind it.
 *
 * They are returned together because the two callers need both: an online
 * evaluation asks the gateway for the project's provider and the managed
 * service whether LangWatch supplies its credentials, and answering those from
 * two differently-composed graphs is how a managed-Bedrock organization gets
 * its own key on one path and the proxy credentials on the other.
 */
export type WorkerModelProviders = Readonly<{
  modelProviders: ModelProviderService;
  managedProviders: ManagedProviderService;
}>;

/**
 * The tenancy graph a provider row's scope is derived from.
 *
 * One value rather than three options because it IS one graph: the project
 * service resolves a project's organization through the organization service,
 * and the permission service answers for both. A gateway holding a project
 * service built over one organization service and an authorization service
 * built over another would derive a scope nothing else in the process agrees
 * with.
 */
export type WorkerModelProviderTenancy = Readonly<{
  projects: ProjectService;
  organizations: OrganizationService;
  authorization: AuthzService;
}>;

/**
 * Composes the gateway only when this process has everything it needs to
 * answer correctly, and says which precondition was missing when it does not.
 *
 * Both gates refuse rather than degrade, and for the same reason: a gateway
 * without the cipher reports every configured provider as unusable, and one
 * without the tenancy graph resolves a project to no scopes at all — which
 * reads on the screen as "you have configured no providers" for a customer who
 * has configured several.
 */
export function tryCreateWorkerModelProviders(
  options: Omit<
    WorkerModelProviderCompositionOptions,
    "encryption" | "projects" | "organizations" | "authorization"
  > & {
    encryption: ModelProviderCredentialCipherPort | undefined;
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
    ? nlpProxyBaseUrl({ baseUrl: nlpServiceUrl })
    : undefined;
  if (!executionProxyBaseUrl) options.absence?.withoutModelTranslation();
  if (!options.redis) options.absence?.withoutConnectionWindows();

  const modelProviders = PostgresModelProviderAdapter.create({
    database: options.database,
    projects: options.projects,
    organizations: options.organizations,
    authorization: options.authorization,
    credentials: EncryptedModelProviderCredentialAdapter.create({ cipher: options.encryption }),
    codexTokenRefresher: CodexOAuthModelProviderTokenRefresherAdapter.create(),
    connectionRateLimiter: WindowedModelProviderConnectionRateLimiterAdapter.create({
      limiter: options.redis
        ? new WorkerModelProviderRateLimit(options.redis)
        : new AbsentWorkerModelProviderRateLimit(),
    }),
    catalog: RegistryModelProviderCatalogAdapter.create({
      managed: WorkerManagedModelProviderGatewayAdapter.create({ service: managedProviders }),
      probe: HttpModelProviderCredentialProbeAdapter.create({
        egress: SsrfModelProviderEgressAdapter.create({
          policy: {
            blockLocal: options.config.infrastructure.modelProvider.blockLocalHttpCalls,
            allowedHosts: options.config.infrastructure.modelProvider.allowedProxyHosts,
            // Tied to the hosted flag rather than to the address policy, the
            // same join the webhook sender makes: an on-prem install calling a
            // service with a self-signed certificate is a different question
            // from whether private addresses are reachable.
            verifyTls: options.config.deployment.saas,
          },
        }),
      }),
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
  }).build();

  return { modelProviders, managedProviders };
}

/** Composes the Enterprise managed-provider service over this process's projects. */
function composeWorkerManagedProviders(input: {
  projects: ProjectService;
  environment: Readonly<Record<string, string | undefined>>;
  logger: Logger;
}): ManagedProviderService {
  return PostgresManagedProviderAdapter.create({
    projects: input.projects,
    configuration: EnvironmentManagedProviderConfigurationAdapter.create({
      source: input.environment,
      reporter: WorkerManagedProviderConfigurationReporter.create(input.logger),
    }),
    credentials: AwsStsManagedProviderCredentialAdapter.create(),
  }).build();
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
 * The two managed-provider answers the catalogue asks for, from the Enterprise
 * service.
 *
 * A narrow adapter rather than the service itself, because the model-provider
 * package is not Enterprise and may not name an Enterprise contract. The
 * composition root is the one place both are in scope.
 */
class WorkerManagedModelProviderGatewayAdapter extends ModelProviderManagedGatewayPort {
  static create(input: {
    service: ManagedProviderService;
  }): WorkerManagedModelProviderGatewayAdapter {
    return new WorkerManagedModelProviderGatewayAdapter(input.service);
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

/**
 * The connection-test windows, counted where this process counts every other
 * shared ceiling.
 *
 * A frozen twin of the Redis branch of the App's own `rateLimit.ts`, down to
 * the `langwatch:ratelimit:` prefix, for the reason the webhook dispatch cap
 * beside it is one: the window is a SHARED budget, and a process counting
 * under a different key spends a budget the other tier was protecting.
 */
class WorkerModelProviderRateLimit extends ModelProviderRateLimitPort {
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
    const now = Date.now();
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
 * The window a deployment with no Redis cannot count.
 *
 * It refuses rather than allowing. An in-memory counter here would be a SECOND
 * budget beside the one the other tier is spending, so a customer hammering
 * connection tests would get twice the ceiling the limit exists to impose;
 * refusing costs a deployment with no Redis its connection-test button and
 * nothing else, because every other gateway path is a read.
 */
class AbsentWorkerModelProviderRateLimit extends ModelProviderRateLimitPort {
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
 * Translating a customer's text, where the deployment named no NLP engine.
 *
 * A translation is a MODEL CALL executed against the OpenAI-compatible proxy
 * that hangs off the engine's address, and `LANGWATCH_NLP_SERVICE` is what
 * names it. With one set, the packaged `VercelAiModelTranslationAdapter` — the
 * SAME adapter the API tier composes — takes this seat, so the two tiers cannot
 * translate through different proxies. Without one there is no address to dial,
 * and this refuses by name rather than answering a silent empty string.
 */
class AbsentWorkerModelTranslation extends ModelTranslationPort {
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
