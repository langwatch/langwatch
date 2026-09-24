import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import { defineServerModule } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";

import { ModelProviderApp } from "./app/model-provider.app.ts";
import type {
  ModelProviderCodexDeviceFlow,
  ModelProviderInfrastructure,
} from "./app/model-provider.app.ts";
import type {
  CodexTokenRefresher,
  CustomKeysRead,
  ModelCostProject,
  ModelProviderCatalog,
  ModelProviderConnectionRateLimiter,
  ModelProviderCredentialCipher,
  ModelProviderCredentialCodec,
  ModelProviderIdService,
  ModelProviderManagedGateway,
  ModelProviderRateLimit,
  ModelTranslation,
} from "./app/model-provider.members.ts";
import { modelProviderConnectionPingChannels } from "./channels/model-provider-connection-ping-channels.registry.ts";
import { type ModelProviderConnectionPing } from "./channels/model-provider-connection-ping.channel.ts";
import { modelProviderRepositories } from "./repositories/model-provider-repositories.registry.ts";
import { PrismaModelCostRepository } from "./repositories/prisma/prisma.model-cost.repository.ts";
import { PrismaModelDefaultRepository } from "./repositories/prisma/prisma.model-default.repository.ts";
import { PrismaModelProviderRepository } from "./repositories/prisma/prisma.model-provider.repository.ts";
import {
  CodexAccountService,
  CodexOAuthModelProviderTokenRefresherAdapter,
} from "./services/codex-oauth.model-provider-token-refresher.service.ts";
import { EncryptedModelProviderCredentialAdapter } from "./services/encrypted.model-provider-api-key-credential.service.ts";
import { HttpModelProviderCredentialProbeAdapter } from "./services/http.model-provider-credential-probe.service.ts";
import { ModelCostCatalogService } from "./services/model-cost-catalog.service.ts";
import { ModelProviderExecutionHandleService } from "./services/model-provider-execution-handle.service.ts";
import { ModelProviderKeysService } from "./services/model-provider-keys.service.ts";
import { ModelProviderProjectScopeService } from "./services/model-provider-project-scope.service.ts";
import { ModelProviderService } from "./services/model-provider.service.ts";
import { PrefixedModelProviderIdAdapter } from "./services/prefixed.model-provider-id.service.ts";
import { RegistryModelProviderCatalogAdapter } from "./services/registry.model-provider-catalog.service.ts";
import {
  SsrfModelProviderEgressAdapter,
  type ModelProviderEgressPolicy,
} from "./services/ssrf.model-provider-egress.service.ts";
import { UnavailableModelProviderCredentialProbeAdapter } from "./services/unavailable.model-provider-credential-probe.service.ts";
import { UnmanagedModelProviderGatewayAdapter } from "./services/unmanaged.model-provider-gateway.service.ts";
import { VercelAiModelTranslationAdapter } from "./services/vercel-ai.model-translation.service.ts";
import { WindowedModelProviderConnectionRateLimiterAdapter } from "./services/windowed.model-provider-connection-rate-limiter.service.ts";
import { llmModelCostTrpcTransport } from "./transport/llm-model-cost.trpc.ts";
import { modelDefaultsRest, modelDefaultsRestCredential } from "./transport/model-defaults.rest.ts";
import { modelProviderRest } from "./transport/model-provider.rest.ts";
import { modelProviderTrpcTransport } from "./transport/model-provider.trpc.ts";
import { playgroundRest } from "./transport/playground.rest.ts";
import { translateTrpcTransport } from "./transport/translate.trpc.ts";

export type { ModelProviderInfrastructure } from "./app/model-provider.app.ts";

export const modelProviderServer = defineServerModule("model-provider")
  .withRepositories(modelProviderRepositories)
  .withApp(ModelProviderApp)
  .withTransports(
    modelProviderRest,
    modelDefaultsRest,
    playgroundRest,
    modelProviderTrpcTransport,
    llmModelCostTrpcTransport,
    translateTrpcTransport,
  )
  .withTransportFacts(() => [
    bindRestMiddleware(modelDefaultsRestCredential, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      if (credential.type !== "apiKey") return null;

      return {
        apiKeyId: credential.apiKeyId,
        userId: credential.userId,
        organizationId: credential.organizationId,
      };
    }),
  ]);

// Model Provider's composition seam: a process composes the gateway through the factories below
// and never names one of this module's adapters, services or repositories. What it passes are its
// own substrates and the two decisions only a deployment can answer — whether it is hosted, and
// which execution proxy a translation runs against.
/** The execution proxy a translation is run against, when the process joined one. */
export type ModelProviderTranslationSurface =
  | Readonly<{ executionProxyBaseUrl: string }>
  | ModelTranslation;

export interface PostgresModelProviderAdapterOptions {
  database: ProcessMembers["prisma"];
  projects: ProjectApi;
  organizations: OrganizationApi;
  catalog: ModelProviderCatalog;
  translation: ModelTranslation;
  connectionPing: ModelProviderConnectionPing;
  ids: ModelProviderIdService;
  authorization: AuthzApi;
  credentials: ModelProviderCredentialCodec;
  codexTokenRefresher: CodexTokenRefresher;
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
}

/** Composes the public Model Provider service with its private Postgres adapters. */
export class PostgresModelProviderAdapter {
  private constructor(private readonly options: PostgresModelProviderAdapterOptions) {}

  static create(options: PostgresModelProviderAdapterOptions): PostgresModelProviderAdapter {
    return new PostgresModelProviderAdapter(options);
  }

  build(): ModelProviderService {
    return ModelProviderService.create({
      repository: PrismaModelProviderRepository.create(
        this.options.database,
        this.options.credentials,
      ),
      projects: this.options.projects,
      organizations: this.options.organizations,
      credentialPolicy: ModelProviderKeysService.create(),
      codexTokenRefresher: this.options.codexTokenRefresher,
      connectionRateLimiter: this.options.connectionRateLimiter,
      defaults: PrismaModelDefaultRepository.create(this.options.database),
      costs: PrismaModelCostRepository.create(this.options.database),
      catalog: this.options.catalog,
      authorization: this.options.authorization,
      translation: this.options.translation,
      connectionPing: this.options.connectionPing,
      ids: this.options.ids,
    });
  }
}

/** The one model the cost listing needs from the client. */
export type ModelCostCatalogDatabase = Pick<ProcessMembers["prisma"], "customLLMModelCost">;

/**
 * A project's own model cost rules, composed from one Prisma client and one project read,
 * instead of `ModelProviderApi`'s nine collaborators a span-pricing read never needs. Satisfies
 * Trace's `TraceModelCostCatalog`, same as `ModelProviderApi`, which delegates to this service.
 */
export class PrismaModelCostCatalogRepository {
  static create(options: {
    database: ModelCostCatalogDatabase;
    projects: ModelCostProject;
  }): PrismaModelCostCatalogRepository {
    return new PrismaModelCostCatalogRepository(options.database, options.projects);
  }

  private constructor(
    private readonly database: ModelCostCatalogDatabase,
    private readonly projects: ModelCostProject,
  ) {}

  build(): ModelCostCatalogService {
    return ModelCostCatalogService.create({
      costs: PrismaModelCostRepository.create(this.database),
      scopes: ModelProviderProjectScopeService.create({ projects: this.projects }),
    });
  }
}

export type ModelProviderRuntimeInput = Readonly<{
  /** The one guarded connection every provider, default and cost row is read on. */
  database: PostgresModelProviderAdapterOptions["database"];
  /** Resolves a project's team and organization, for scope derivation. */
  projects: PostgresModelProviderAdapterOptions["projects"];
  /** Resolves an organization, for the organization-scoped provider rows. */
  organizations: PostgresModelProviderAdapterOptions["organizations"];
  /** Decides who may read and write a provider row. */
  authorization: PostgresModelProviderAdapterOptions["authorization"];
  /**
   * The deployment's stored-secret cipher. Required rather than optional: without one every
   * provider would look configured-but-unusable, because no stored credential could be read.
   */
  encryption: ModelProviderCredentialCipher;
  /** The shared counters a connection test's fixed window is metered in. */
  connectionRateLimiter: ModelProviderRateLimit;
  /** The environment the system-held provider credentials are read from. */
  systemProviderEnvironment: Readonly<Record<string, string | undefined>>;
  /** Whether this is the hosted deployment, which decides the managed rows and TLS posture. */
  isSaas: boolean;
  translation: ModelProviderTranslationSurface;
  /** The execution proxy Test Connection sends its one real generation through. */
  executionProxyBaseUrl: string;
  /**
   * The fence an outbound credential probe goes through. A process that names none composes no
   * probe: a credential test with no fence is one this deployment has not decided it may make.
   */
  egress?: ModelProviderEgressPolicy;
  /** The managed provider rows, when a deployment has an Enterprise service answering them. */
  managedGateway?: ModelProviderManagedGateway;
  /** The random half of a minted identifier, in the format this process mints ids in. */
  idSuffix: () => string;
}>;

/**
 * The gateway, and what the installed module is built over in this same process — one value, so
 * the two can never be composed from two different registries.
 */
export type ModelProviderRuntime = Readonly<{
  modelProviders: ReturnType<PostgresModelProviderAdapter["build"]>;
  credentials: ModelProviderCredentialCodec;
  /** Everything but the request's span reader, which the transport supplies per call. */
  infrastructure: Omit<ModelProviderInfrastructure, "spans">;
}>;

/** Composes the model gateway from a process's own graph. */
export function createModelProviderRuntime(input: ModelProviderRuntimeInput): ModelProviderRuntime {
  const credentials = EncryptedModelProviderCredentialAdapter.create({ cipher: input.encryption });
  const credentialProbe = input.egress
    ? HttpModelProviderCredentialProbeAdapter.create({
        egress: SsrfModelProviderEgressAdapter.create({ policy: input.egress }),
      })
    : UnavailableModelProviderCredentialProbeAdapter.create();
  const ids = PrefixedModelProviderIdAdapter.create({ suffix: input.idSuffix });
  const technical = {
    codexTokenRefresher: CodexOAuthModelProviderTokenRefresherAdapter.create(),
    connectionRateLimiter: WindowedModelProviderConnectionRateLimiterAdapter.create({
      limiter: input.connectionRateLimiter,
    }),
    catalog: RegistryModelProviderCatalogAdapter.create({
      managed: input.managedGateway ?? UnmanagedModelProviderGatewayAdapter.create(),
      probe: credentialProbe,
      systemProviderEnvironment: input.systemProviderEnvironment,
      isSaas: input.isSaas,
    }),
    translation:
      "executionProxyBaseUrl" in input.translation
        ? VercelAiModelTranslationAdapter.create({
            projects: input.projects,
            executionProxyBaseUrl: input.translation.executionProxyBaseUrl,
          })
        : input.translation,
    connectionPing: modelProviderConnectionPingChannels.live.create({
      executionProxyBaseUrl: input.executionProxyBaseUrl,
    }),
    ids,
  };

  return {
    modelProviders: PostgresModelProviderAdapter.create({
      database: input.database,
      projects: input.projects,
      organizations: input.organizations,
      authorization: input.authorization,
      credentials,
      ...technical,
    }).build(),
    credentials,
    infrastructure: {
      ...technical,
      credentialProbe,
      codexAccounts: createModelProviderCodexDeviceFlow(),
    },
  };
}

/** The Codex device ceremony's two answers, over this deployment's own issuer. */
export function createModelProviderCodexDeviceFlow(): ModelProviderCodexDeviceFlow {
  return new CodexAccountService();
}

/**
 * The model cost catalogue a trace's cost is priced against, over the
 * deployment's own connection.
 */
export function createModelProviderCostCatalog(
  input: Parameters<typeof PrismaModelCostCatalogRepository.create>[0],
): ModelCostCatalogService {
  return PrismaModelCostCatalogRepository.create(input).build();
}

/**
 * The custom keys stored beside a provider row, decoded. A read rather than a
 * service: the caller holds a stored value and wants the keys in it.
 */
export function readModelProviderCustomKeys(
  input: Readonly<{
    stored: unknown;
    decryptor: Parameters<typeof EncryptedModelProviderCredentialAdapter.readCustomKeys>[1];
  }>,
): CustomKeysRead {
  return EncryptedModelProviderCredentialAdapter.readCustomKeys(input.stored, input.decryptor);
}

/** What a feature asks for when it needs a model to call, resolved through the scope cascade. */
export type ModelProviderExecutionHandleRequest = Parameters<
  typeof ModelProviderExecutionHandleService.getVercelAIModel
>[0];

/** The resolved model, ready to be called. */
export type ModelProviderExecutionHandle = Awaited<
  ReturnType<typeof ModelProviderExecutionHandleService.getVercelAIModel>
>;

/**
 * Resolves the model a feature call runs on, through the project's own scope cascade. Refuses
 * with `ModelNotConfiguredError` when the cascade resolves nothing, so the caller can decide.
 */
export function resolveModelProviderExecutionHandle(
  request: ModelProviderExecutionHandleRequest,
): Promise<ModelProviderExecutionHandle> {
  return ModelProviderExecutionHandleService.getVercelAIModel(request);
}
