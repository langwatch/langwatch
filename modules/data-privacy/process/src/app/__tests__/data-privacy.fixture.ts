import type { ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { ModuleSecretsScope } from "@langwatch/process";
import type { Team } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";

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

/** The test project as project's and organization's rows place it; overrides move or archive it. */
export function dataPrivacyTestPlacement(
  overrides: Partial<DataPrivacyProjectScope> = {},
): DataPrivacyProjectScope {
  return {
    projectId: dataPrivacyTestGraph.projectId,
    organizationId: dataPrivacyTestGraph.organizationId,
    teamId: dataPrivacyTestGraph.teamId,
    isPersonal: false,
    departmentId: null,
    archived: false,
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
}: {
  directory?: MemoryDataPrivacyDirectoryRepository;
  dependencies: Parameters<typeof DataPrivacyModule.create>[0]["dependencies"];
  enforcement?: string;
}): Promise<DataPrivacyModule> {
  const config = {
    googleDlpDisabled: undefined,
    enforcement,
    nodeEnvironment: undefined,
    langevalsEndpoint: undefined,
  };
  return DataPrivacyModule.create({
    repositories: {
      ...MemoryDataPrivacyRepositories.create(),
      directory,
      projectScopes: createDataPrivacyTestScopes(),
    },
    channels: MemoryDataPrivacyChannels.create({ config }),
    dependencies,
    config,
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    resources: { own: () => void 0, ownService: () => void 0 },
  });
}
