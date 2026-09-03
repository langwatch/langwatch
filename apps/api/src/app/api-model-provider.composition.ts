/**
 * The model gateway, composed over this process's own graph.
 *
 * Until this module existed `modelProviders` was a host OPTION and nobody
 * supplied one, so the EXECUTION half — `workflow.*`, `optimization.*`,
 * `experiments.*` and `evaluations.*` — was structurally unreachable in
 * production: a Studio node's model is resolved per run, the workflow service
 * cannot be built without a gateway, and the six ports
 * `PostgresModelProviderAdapter` needs were all `platform/app` classes.
 *
 * They are not any more. Every one of the six is composed here: four are
 * answered from services this process ALREADY holds, and the implementations
 * that were platform-only moved into `@langwatch/model-provider-server` with
 * the originals deleted:
 *
 *   credentials      the deployment's stored-secret cipher — the SAME
 *                    `SecretEncryptionPort` the secret service is built on, so
 *                    a credential written by the platform app decrypts here
 *                    and one written here decrypts there. Its lenient read
 *                    (legacy plaintext row, absent column, undecryptable
 *                    column) moved into the package with it.
 *   rateLimiter      the process's own fixed-window counter, over the SAME
 *                    Redis the queue owns. The two windows a connection test
 *                    is bounded by are the feature's and moved with it.
 *   ids              the feature's three row prefixes over this process's
 *                    `nanoid`.
 *   catalog          the packaged registry plus three facts that are the
 *                    DEPLOYMENT's: which system providers it credentials,
 *                    whether it is the hosted install, and its guarded egress.
 *   codexRefresher   the OAuth device-flow account service, moved whole.
 *   translation      one model call through the moved resolution cascade.
 *
 * ## What is named absent, and what that costs
 *
 * **Codex handles.** A codex model executes on the AI gateway's Responses
 * endpoint under the project's virtual key, and this process composes no
 * virtual-key provisioner. The cascade therefore refuses a codex model BY NAME
 * rather than resolving it to something else — silently substituting a model
 * the customer did not choose is the failure that refusal exists to prevent.
 * Every other provider is unaffected.
 *
 * **Managed providers.** `ModelProviderManagedGatewayPort` decides whether
 * LangWatch supplies an organization's credentials. It is answered here from
 * the Enterprise managed-provider service, composed over the same project
 * service, so a managed-Bedrock organization's run gets the proxy credentials
 * it has always got. A deployment without the Enterprise configuration gets
 * the same service answering "no organization is managed", which is the true
 * answer rather than a default.
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
import { nlpProxyBaseUrl } from "@langwatch/workflow-server";
import { nanoid } from "nanoid";
import type { ApiRateLimitRequest, ApiRateLimitResult } from "../platform/infrastructure/api-rate-limit.infrastructure";

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
   * The deployment's stored-secret cipher.
   *
   * Required: a gateway composed without one could not read a single stored
   * credential, and every provider would look configured-but-unusable. The
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
   * The address policy a credential probe is fenced by, and whether its TLS is
   * verified.
   *
   * The deployment's, so it arrives whole from configuration: the metadata
   * endpoints and the cloud-provider domains are refused by the fence itself
   * whatever this says.
   */
  egress: ModelProviderEgressPolicy;
  /**
   * Where the NLP engine answers, which is also where a resolved model is
   * executed: the OpenAI-compatible proxy hangs off it.
   *
   * Absent is a deployment that executes nothing, and it is the same shape the
   * workflow NLP port has — the cascade still answers "you have configured no
   * providers" and "that provider is switched off" first, because those are
   * the answers a customer can act on.
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
        ? nlpProxyBaseUrl({ baseUrl: options.nlpServiceUrl })
        : UNCONFIGURED_EXECUTION_PROXY,
      // No `codexHandles`: see the module docblock.
    }),
    ids: PrefixedModelProviderIdAdapter.create({ suffix: () => nanoid() }),
  }).build();
}

/**
 * The address a resolved model is executed against when no engine is
 * configured.
 *
 * A URL rather than an absence because the cascade's own answers — "you have
 * configured no providers", "the provider you chose is switched off" — are the
 * ones a customer can act on, and they come first. A deployment with no engine
 * reaches this only after resolving a model successfully, and the call then
 * fails as a connection failure to a name that says why.
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
 * The two managed-provider answers the catalogue asks for, from the Enterprise
 * service.
 *
 * A narrow adapter rather than the service itself, because the model-provider
 * package is not Enterprise and may not name an Enterprise contract. The
 * composition root is the one place both are in scope.
 */
class ApiManagedModelProviderGatewayAdapter extends ModelProviderManagedGatewayPort {
  static create(input: {
    service: ManagedProviderService;
  }): ApiManagedModelProviderGatewayAdapter {
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
 * Names which precondition a model gateway is missing, so an operator reading
 * "no workflow surfaces" can tell a deployment that has no database from one
 * whose tenancy graph never composed.
 *
 * `no-encryption` is the third reason and the one no composition root reaches:
 * the tenancy graph is gated on the same cipher, so a half reached with a
 * composed tenancy provably holds one. It stays because the cipher is this
 * half's own non-optional input, and a gateway that vanished silently would be
 * worse than one that names the precondition it wanted.
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
