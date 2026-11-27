import type { ApiKey, ApiKeyApi } from "@langwatch/api-key-contract";
import type {
  DataPrivacyServerConfig,
  ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { ModuleSecretsScope } from "@langwatch/process";
import type { Team } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type { DataPrivacyChannels } from "../../channels/data-privacy.channels.ts";
import { MemoryDataPrivacyChannels } from "../../channels/memory/memory.data-privacy.channels.ts";
import type { DataPrivacyProjectScope } from "../../repositories/data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyDirectoryRepository } from "../../repositories/memory/memory.data-privacy-directory.repository.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyRepositories } from "../../repositories/memory/memory.data-privacy.repositories.ts";
import type { DataPrivacyResolutionService } from "../../services/data-privacy-resolution.service.ts";
import { DataPrivacyModule } from "../data-privacy.app.ts";

/** The policy source the redaction cases drive their PII cases over. */
export class DataPrivacyResolutionFake implements Pick<
  DataPrivacyResolutionService,
  "getResolvedForProject"
> {
  constructor(private readonly resolved: ResolvedDataPrivacy) {}

  async getResolvedForProject(): Promise<ResolvedDataPrivacy> {
    return this.resolved;
  }
}

/** The one project every privacy case in this package is opened from. */
export const dataPrivacyTestGraph = {
  projectId: "project-1",
  teamId: "team-1",
  organizationId: "organization-1",
} as const;

const EPOCH = new Date(0);

export function dataPrivacyTestTeam(): Team {
  return {
    id: dataPrivacyTestGraph.teamId,
    name: "Platform",
    slug: "platform",
    organizationId: dataPrivacyTestGraph.organizationId,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  };
}

/** The test project as project's and organization's rows place it; overrides move it. */
export function dataPrivacyTestPlacement(
  overrides: Partial<DataPrivacyProjectScope> = {},
): DataPrivacyProjectScope {
  return {
    projectId: dataPrivacyTestGraph.projectId,
    organizationId: dataPrivacyTestGraph.organizationId,
    teamId: dataPrivacyTestGraph.teamId,
    isPersonal: false,
    departmentId: null,
    ...overrides,
  };
}

/** Data privacy's placement reader, holding the one test project. */
export function createDataPrivacyTestScopes(): MemoryDataPrivacyProjectScopeRepository {
  return MemoryDataPrivacyProjectScopeRepository.create({ projects: [dataPrivacyTestPlacement()] });
}

/** `createApp` composes no secrets chain, so the module's one secret is answered here. */
export function dataPrivacyTestSecrets({
  googleCredentials,
}: { googleCredentials?: string } = {}): ModuleSecretsScope {
  return () => new ScopedSecrets(async (_handle, build) => build(googleCredentials));
}

/** The app built directly over memory repositories, for a case that seeds the directory. */
export async function createDataPrivacyTestApp({
  directory = MemoryDataPrivacyDirectoryRepository.create(),
  dependencies,
  enforcement,
  settings = {},
  channels,
  keyPepper = "test-key-pepper",
  organizationKeys = [],
}: {
  directory?: MemoryDataPrivacyDirectoryRepository;
  dependencies: Parameters<typeof DataPrivacyModule.create>[0]["dependencies"];
  enforcement?: string;
  /** Deployment settings over the defaults, such as the analysis endpoints. */
  settings?: Partial<DataPrivacyServerConfig>;
  /** Channels composed from the settings; memory channels when absent. */
  channels?: (config: DataPrivacyServerConfig) => Promise<Omit<DataPrivacyChannels, "apiKeys">>;
  /** What every secret handle answers, so the key pepper is set; `null` for none. */
  keyPepper?: string | null;
  /** What api-key lists as the organization's keys (ADR-208). */
  organizationKeys?: ApiKey[];
}): Promise<DataPrivacyModule> {
  const apiKeys = createApiFixture<ApiKeyApi>({ listAll: async () => organizationKeys });
  const config: DataPrivacyServerConfig = {
    googleDlpDisabled: undefined,
    enforcement,
    nodeEnvironment: undefined,
    isSaas: true,
    langevalsEndpoint: undefined,
    piiRedactionModelEndpoint: undefined,
    ...settings,
  };
  return DataPrivacyModule.create({
    repositories: {
      ...MemoryDataPrivacyRepositories.create(),
      directory,
      projectScopes: createDataPrivacyTestScopes(),
    },
    channels: channels
      ? { ...(await channels(config)), apiKeys }
      : MemoryDataPrivacyChannels.create({ config, bound: { apiKeys } }),
    dependencies,
    config,
    secrets: new ScopedSecrets(async (_handle, build) => build(keyPepper ?? undefined)),
    resources: { own: () => void 0, ownService: () => void 0 },
  });
}
