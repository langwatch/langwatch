import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  internalProjectKindSchema,
  internalProjectQuerySchema,
  type InternalProject,
  type InternalProjectKind,
  type InternalProjectQuery,
} from "@langwatch/project-contract";

import type { ProjectRepository } from "../repositories/project.repository.ts";
import type { ProjectCredentials } from "./project-credentials.service.ts";

/** How each internal project kind is named when it is first created. */
const INTERNAL_PROJECT_NAMING: Record<
  InternalProjectKind,
  { name: string; slugPrefix: string; framework: string }
> = {
  internal_governance: {
    name: "Governance (internal)",
    slugPrefix: "governance",
    framework: "governance",
  },
  internal_checkup: {
    name: "Checkup canary (internal)",
    slugPrefix: "checkup",
    framework: "checkup",
  },
};

/** The organisation's internal projects (governance, checkup canary): found, or made once. */
export class InternalProjectService {
  private readonly repository: ProjectRepository;
  private readonly credentials: ProjectCredentials;
  private readonly organizations: OrganizationApi;

  private constructor(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
  }) {
    this.repository = options.repository;
    this.credentials = options.credentials;
    this.organizations = options.organizations;
  }

  /** Builds the service over the project store, key minting and the organisation's teams. */
  static create(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
  }): InternalProjectService {
    return new InternalProjectService(options);
  }

  /** The organisation's internal project of this kind, or null when none exists yet. */
  find(input: InternalProjectQuery): Promise<InternalProject | null> {
    const parsed = internalProjectQuerySchema.parse(input);

    return this.repository.findInternalByOrganization(parsed);
  }

  /** The ids of every live internal project of this kind, across organisations. */
  findIds(input: { kind: InternalProjectKind }): Promise<string[]> {
    return this.repository.findLiveInternalIds({
      kind: internalProjectKindSchema.parse(input.kind),
    });
  }

  /** The organisation's internal project of this kind, created in its oldest team if absent. */
  async ensure(input: InternalProjectQuery): Promise<InternalProject> {
    const parsed = internalProjectQuerySchema.parse(input);
    const existing = await this.repository.findInternalByOrganization(parsed);
    if (existing) {
      return existing;
    }

    const teamId = await this.organizations.getOldestTeamId({
      organizationId: parsed.organizationId,
    });
    const naming = INTERNAL_PROJECT_NAMING[parsed.kind];
    const slug = `${naming.slugPrefix}-${parsed.organizationId}`;
    const bySlug = await this.repository.findInternalBySlug(slug);
    if (bySlug?.kind === parsed.kind) {
      return bySlug;
    }

    return this.repository.createInternalOrFindWinner({
      id: this.credentials.generateProjectId(),
      name: naming.name,
      slug,
      apiKey: this.credentials.generateApiKey(),
      teamId,
      kind: parsed.kind,
      framework: naming.framework,
    });
  }
}
