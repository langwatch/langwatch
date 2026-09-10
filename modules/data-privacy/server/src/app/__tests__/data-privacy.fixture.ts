import type { DataPrivacyScope, ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { ProjectApi, ProjectWithTeam, Team } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  type DataPrivacyDirectoryReader,
  type DataPrivacyOrganizationDirectory,
  type DataPrivacyProjectLineage,
} from "../data-privacy.app.ts";
import { DataPrivacyResolution } from "../data-privacy.infrastructure.ts";
import { PiiAnalysis } from "../data-privacy.infrastructure.ts";

/** The policy source the redaction cases drive their PII cases over. */
export class DataPrivacyResolutionFake implements DataPrivacyResolution {
  constructor(private readonly resolved: ResolvedDataPrivacy) {}

  async getResolvedForProject(): Promise<ResolvedDataPrivacy> {
    return this.resolved;
  }
}

/** One organization's lineage, held in the test rather than in Postgres. */
export class MemoryDataPrivacyDirectory implements DataPrivacyDirectoryReader {
  static create(
    rows: {
      lineage?: DataPrivacyProjectLineage;
      directory?: DataPrivacyOrganizationDirectory;
      scopeOrganizationId?: string | null;
    } = {},
  ): MemoryDataPrivacyDirectory {
    return new MemoryDataPrivacyDirectory(rows);
  }

  private constructor(
    private readonly rows: {
      lineage?: DataPrivacyProjectLineage;
      directory?: DataPrivacyOrganizationDirectory;
      scopeOrganizationId?: string | null;
    },
  ) {}

  async findProjectLineage(): Promise<DataPrivacyProjectLineage | null> {
    return this.rows.lineage ?? null;
  }

  async listOrganizationDirectory(): Promise<DataPrivacyOrganizationDirectory> {
    return this.rows.directory ?? { departments: [], teams: [], projects: [], groups: [] };
  }

  async findScopeOrganizationId(input: { scope: DataPrivacyScope }): Promise<string | null> {
    void input;
    return this.rows.scopeOrganizationId ?? null;
  }
}

/** An analysis transport that is composed but never reached by a test. */
export class UnusedPiiAnalysis implements PiiAnalysis {
  static create(): UnusedPiiAnalysis {
    return new UnusedPiiAnalysis();
  }

  async tryClearGoogleDlp(): Promise<string | null> {
    throw new Error("the PII analysis transport is not configured for this test");
  }

  async clearPresidio(): Promise<(string | null)[]> {
    throw new Error("the PII analysis transport is not configured for this test");
  }

  async close(): Promise<void> {}
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
export function dataPrivacyTestInfrastructure(directory = MemoryDataPrivacyDirectory.create()) {
  return {
    directory,
    pii: {
      transport: UnusedPiiAnalysis.create(),
      isLangevalsConfigured: false,
      isProduction: false,
      nativePolicyEnforced: false,
      piiRedactionMaxAttributeLength: 250_000,
    },
  };
}
