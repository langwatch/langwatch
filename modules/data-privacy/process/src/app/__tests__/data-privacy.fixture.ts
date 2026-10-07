import type { DataPrivacyApi, ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { ModuleSecretsScope } from "@langwatch/process";
import { PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE, type Team } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { vi } from "vitest";

import type { ProjectFact } from "../../eventing/__tests__/data-privacy-project-scope.fixture.ts";
import type { MemoryDataPrivacyDirectoryRepository } from "../../repositories/memory/memory.data-privacy-directory.repository.ts";
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

/** Data privacy's own fold, holding the one test project as project's facts would leave it. */
export async function createDataPrivacyTestScopes(): Promise<MemoryDataPrivacyProjectScopeRepository> {
  const repository = MemoryDataPrivacyProjectScopeRepository.create();
  await repository.recordTeam({
    projectId: dataPrivacyTestGraph.projectId,
    organizationId: dataPrivacyTestGraph.organizationId,
    teamId: dataPrivacyTestGraph.teamId,
    isPersonal: false,
    recordedAtMs: 1,
  });
  return repository;
}

/** The test project as project records it, appended and waited on until data privacy folds it. */
export async function foldDataPrivacyTestProject({
  append,
  app,
}: {
  append: (fact: ProjectFact, id: string) => Promise<unknown>;
  app: Pick<DataPrivacyApi, "getResolvedForProject">;
}): Promise<void> {
  const { projectId, organizationId, teamId } = dataPrivacyTestGraph;
  await append(
    {
      type: PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
      data: {
        tenantId: projectId,
        projectId,
        organizationId,
        occurredAt: 10,
        departmentId: null,
        teamId,
        isPersonal: false,
        backfilled: true,
      },
    },
    "event-department-assigned",
  );
  await vi.waitFor(() => app.getResolvedForProject({ projectId }));
}

/** `createApp` composes no secrets chain, so the module's one secret is answered here. */
export function dataPrivacyTestSecrets({
  googleCredentials,
}: { googleCredentials?: string } = {}): ModuleSecretsScope {
  return () => new ScopedSecrets(async (_handle, build) => build(googleCredentials));
}

/** The app built directly over memory repositories, for a case that seeds the directory. */
export async function createDataPrivacyTestApp({
  directory,
  dependencies,
}: {
  directory: MemoryDataPrivacyDirectoryRepository;
  dependencies: Parameters<typeof DataPrivacyModule.create>[0]["dependencies"];
}): Promise<DataPrivacyModule> {
  return DataPrivacyModule.create({
    repositories: {
      ...MemoryDataPrivacyRepositories.create(),
      directory,
      projectScopes: await createDataPrivacyTestScopes(),
    },
    dependencies,
    config: {
      googleDlpDisabled: undefined,
      enforcement: undefined,
      nodeEnvironment: undefined,
      langevalsEndpoint: undefined,
    },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    resources: { own: () => void 0, ownService: () => void 0 },
  });
}
