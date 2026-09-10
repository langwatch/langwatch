/**
 * The application a suite drives, over the memory repositories and stand-ins
 * for what a deployment would supply: a registry with no managed providers,
 * an identifier suffix that does not move, and a rate limiter that never
 * refuses. Nothing here reaches a network or a database.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  CodexAccountService,
  CodexOAuthModelProviderTokenRefresherAdapter,
} from "../../services/codex-oauth.model-provider-token-refresher.service.ts";
import { UnavailableModelProviderCredentialProbeAdapter } from "../../services/unavailable.model-provider-credential-probe.service.ts";
import { PrefixedModelProviderIdAdapter } from "../../services/prefixed.model-provider-id.service.ts";
import { RegistryModelProviderCatalogAdapter } from "../../services/registry.model-provider-catalog.service.ts";
import { UnmanagedModelProviderGatewayAdapter } from "../../services/unmanaged.model-provider-gateway.service.ts";
import { VercelAiModelTranslationAdapter } from "../../services/vercel-ai.model-translation.service.ts";
import { WindowedModelProviderConnectionRateLimiterAdapter } from "../../services/windowed.model-provider-connection-rate-limiter.service.ts";
import type { ModelProviderCredentialProbe } from "../model-provider.members.ts";
import type { ModelProviderRepositories } from "../../repositories/model-provider.repositories.ts";
import { MemoryModelProviderRepositories } from "../../repositories/memory/memory.model-provider.repositories.ts";
import { ModelProviderApp, type ModelProviderInfrastructure } from "../model-provider.app.ts";

/** A suite that did not decide the issuer's answers must not reach one. */
const refuseFetch: typeof fetch = () => {
  throw new Error("this suite reached the Codex issuer without deciding its answers");
};

/** The address a resolved model would execute against, unreachable on purpose. */
const UNREACHABLE_EXECUTION_PROXY = "http://nlp-engine-not-configured.invalid";

export function createModelProviderTestProjects(): ProjectApi {
  return createApiFixture<ProjectApi>({
    getWithTeam: async (id: string) => testProject(id),
    tryGetWithTeam: async (id: string) => testProject(id),
  });
}

function testProject(id: string) {
  return {
    id,
    teamId: "team-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    team: { id: "team-1", organizationId: "organization-1" },
  };
}

/** The organization read the scope derivation makes for an organization scope. */
export function createModelProviderTestOrganizations(): OrganizationApi {
  return createApiFixture<OrganizationApi>({
    getBillingProfile: async ({ organizationId }: { organizationId: string }) => ({
      id: organizationId,
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
    }>;
  }> = {},
): ModelProviderApp {
  return ModelProviderApp.create({
    repositories: input.repositories ?? MemoryModelProviderRepositories.create(),
    members: createModelProviderTestInfrastructure(input.members ?? {}),
    dependencies: {
      projects: input.dependencies?.projects ?? createModelProviderTestProjects(),
      organizations:
        input.dependencies?.organizations ?? createModelProviderTestOrganizations(),
      permissions:
        input.dependencies?.permissions ??
        createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}

export type { ModelProviderCredentialProbe };
