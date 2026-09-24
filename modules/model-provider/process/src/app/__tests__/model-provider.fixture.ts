import { createApiFixture } from "@langwatch/api-fixture";
/**
 * The application a suite drives, over memory repositories and stand-ins
 * for what a deployment would supply: a registry with no managed providers,
 * a fixed id suffix, and a rate limiter that never refuses. No network, no DB.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { projectWithTeamSchema, type ProjectApi } from "@langwatch/project-contract";

import { modelProviderConnectionPingChannels } from "../../channels/model-provider-connection-ping-channels.registry.ts";
import { MemoryModelProviderRepositories } from "../../repositories/memory/memory.model-provider.repositories.ts";
import type { ModelProviderRepositories } from "../../repositories/model-provider.repositories.ts";
import {
  CodexAccountService,
  CodexOAuthModelProviderTokenRefresherAdapter,
} from "../../services/codex-oauth.model-provider-token-refresher.service.ts";
import { PrefixedModelProviderIdAdapter } from "../../services/prefixed.model-provider-id.service.ts";
import { RegistryModelProviderCatalogAdapter } from "../../services/registry.model-provider-catalog.service.ts";
import { UnavailableModelProviderCredentialProbeAdapter } from "../../services/unavailable.model-provider-credential-probe.service.ts";
import { UnmanagedModelProviderGatewayAdapter } from "../../services/unmanaged.model-provider-gateway.service.ts";
import { VercelAiModelTranslationAdapter } from "../../services/vercel-ai.model-translation.service.ts";
import { WindowedModelProviderConnectionRateLimiterAdapter } from "../../services/windowed.model-provider-connection-rate-limiter.service.ts";
import { ModelProviderApp, type ModelProviderInfrastructure } from "../model-provider.app.ts";
import type { ModelProviderCredentialProbe } from "../model-provider.members.ts";

/** A suite that did not decide the issuer's answers must not reach one. */
const refuseFetch: typeof fetch = () => {
  throw new Error("this suite reached the Codex issuer without deciding its answers");
};

/** The address a resolved model would execute against, unreachable on purpose. */
const UNREACHABLE_EXECUTION_PROXY = "http://nlp-engine-not-configured.invalid";

export function createModelProviderTestProjects(): ProjectApi {
  return createApiFixture<ProjectApi>({
    getWithTeam: async (id: string) => testProject(id),
    findWithTeam: async (id: string) => testProject(id),
  });
}

function testProject(id: string) {
  return projectWithTeamSchema.parse({
    id,
    name: "Test Project",
    slug: "test-project",
    apiKey: "test-api-key",
    lwqlKey: "test-lwql-key",
    teamId: "team-1",
    language: "typescript",
    framework: "langchain",
    kind: "application",
    firstMessage: false,
    integrated: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      id: "team-1",
      name: "Test Team",
      slug: "test-team",
      organizationId: "organization-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  });
}

/** The organization read the scope derivation makes for an organization scope. */
export function createModelProviderTestOrganizations(): OrganizationApi {
  return createApiFixture<OrganizationApi>({
    getBillingProfile: async ({ organizationId }: { organizationId: string }) => ({
      id: organizationId,
      name: "Test Organization",
      billingCustomerId: null,
    }),
  });
}

/** What a deployment answers, as a suite that decided none of it sees it. */
export function createModelProviderTestInfrastructure(
  overrides: Partial<ModelProviderInfrastructure> = {},
): ModelProviderInfrastructure {
  const projects = createModelProviderTestProjects();

  return {
    catalog: RegistryModelProviderCatalogAdapter.create({
      managed: UnmanagedModelProviderGatewayAdapter.create(),
      probe: UnavailableModelProviderCredentialProbeAdapter.create(),
      systemProviderEnvironment: {},
      isSaas: false,
    }),
    translation: VercelAiModelTranslationAdapter.create({
      projects,
      executionProxyBaseUrl: UNREACHABLE_EXECUTION_PROXY,
    }),
    connectionPing: modelProviderConnectionPingChannels.memory.create(),
    ids: PrefixedModelProviderIdAdapter.create({ suffix: () => "test" }),
    codexTokenRefresher: CodexOAuthModelProviderTokenRefresherAdapter.create(),
    connectionRateLimiter: WindowedModelProviderConnectionRateLimiterAdapter.create({
      limiter: { consume: async () => ({ allowed: true, resetAt: 0 }) },
    }),
    credentialProbe: UnavailableModelProviderCredentialProbeAdapter.create(),
    codexAccounts: new CodexAccountService(refuseFetch),
    spans: {},
    ...overrides,
  };
}

export function createModelProviderTestApp(
  input: Readonly<{
    repositories?: ModelProviderRepositories;
    members?: Partial<ModelProviderInfrastructure>;
    dependencies?: Partial<{
      projects: ProjectApi;
      organizations: OrganizationApi;
      permissions: AuthzApi;
      dataPrivacy: DataPrivacyApi;
    }>;
  }> = {},
): ModelProviderApp {
  return ModelProviderApp.createForTesting({
    repositories: input.repositories ?? MemoryModelProviderRepositories.create(),
    members: createModelProviderTestInfrastructure(input.members ?? {}),
    dependencies: {
      projects: input.dependencies?.projects ?? createModelProviderTestProjects(),
      organizations: input.dependencies?.organizations ?? createModelProviderTestOrganizations(),
      permissions:
        input.dependencies?.permissions ??
        createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
      dataPrivacy: input.dependencies?.dataPrivacy ?? createModelProviderTestDataPrivacy(),
    },
  });
}

/** A deployment holding no Google credential: data privacy lends `undefined`. */
export function createModelProviderTestDataPrivacy(credential?: string): DataPrivacyApi {
  return createApiFixture<DataPrivacyApi>({
    intoGoogleApplicationCredentials: (build) => build(credential),
  });
}

export type { ModelProviderCredentialProbe };
