import type { ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import { withMemoryRepositories } from "@langwatch/process";
import type { ProjectApi, ProjectWithTeam, Team } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { dataPrivacyProcessModule } from "../../data-privacy.module.ts";
import type { MemoryDataPrivacyDirectoryRepository } from "../../repositories/memory/memory.data-privacy-directory.repository.ts";
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

/** The project row the cascade reads its organization, team and department off. */
export function dataPrivacyTestProject(): ProjectWithTeam {
  return {
    id: dataPrivacyTestGraph.projectId,
    name: "Acme production",
    slug: "acme-production",
    apiKey: "key",
    lwqlKey: "lwql-key",
    teamId: dataPrivacyTestGraph.teamId,
    language: "python",
    framework: "openai",
    kind: "default",
    firstMessage: false,
    integrated: true,
    createdAt: EPOCH,
    updatedAt: EPOCH,
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
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: dataPrivacyTestTeam(),
  };
}

/** The project directory the cascade reads, and nothing else configured. */
export function createDataPrivacyTestProjects(): ProjectApi {
  return createApiFixture<ProjectApi>({ getWithTeam: async () => dataPrivacyTestProject() });
}

/** The technical inputs a booted data-privacy feature needs from its process. */
/** `createApp` composes no secrets chain, so the module's one handle is answered here. */
export function installableDataPrivacy({ googleCredentials }: { googleCredentials?: string } = {}) {
  const server = withMemoryRepositories(dataPrivacyProcessModule);
  const secrets = new ScopedSecrets(async (_handle, build) => build(googleCredentials));
  const installable: typeof server = {
    ...server,
    install: (args) => server.install({ ...args, secrets }),
  };
  return installable;
}

/** The app built directly over memory repositories, for a case that seeds the directory. */
export function createDataPrivacyTestApp({
  directory,
  dependencies,
}: {
  directory: MemoryDataPrivacyDirectoryRepository;
  dependencies: Parameters<typeof DataPrivacyModule.create>[0]["dependencies"];
}): Promise<DataPrivacyModule> {
  return DataPrivacyModule.create({
    repositories: { ...MemoryDataPrivacyRepositories.create(), directory },
    dependencies,
    config: { googleDlpDisabled: undefined, enforcement: undefined, nodeEnvironment: undefined },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    resources: { own: () => void 0, ownService: () => void 0 },
  });
}
