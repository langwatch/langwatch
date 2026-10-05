import type { OrganizationApi } from "@langwatch/organization-contract";
import { PROJECT_KIND, type InternalProject, type ProjectApi } from "@langwatch/project-contract";
/**
 * Test-only access for Governance characterization suites: the collaborators
 * a suite needs, built here. Repositories and services stay private to the
 * feature server — a suite states which substrates it has, not which classes to construct.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type { GovernanceClickHouseResolver } from "../repositories/clickhouse/clickhouse.governance-clickhouse.repositories.ts";
import {
  PrismaDepartmentRepository,
  type DepartmentDatabase,
} from "../repositories/prisma/prisma.department.repository.ts";
import {
  PrismaActivityMonitorRepository,
  type ActivityMonitorDatabase,
} from "../repositories/prisma/prisma.ingestion-source-activity.repository.ts";
import {
  type DepartmentOrganizations,
  type DepartmentProjects,
  DepartmentService,
} from "../services/department.service.ts";
import { ActivityMonitorService } from "../services/ingestion-source-activity.service.ts";

function internalGovernanceProject(id: string): InternalProject {
  return {
    id,
    name: "Governance",
    slug: "governance",
    teamId: "governance-team",
    kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    archivedAtMs: null,
    traceSharingEnabled: false,
  };
}

/** A project owner whose hidden governance project is whatever `tenantId` currently names. */
export function createGovernanceProjectApi(tenantId: () => string | null): ProjectApi {
  return createApiFixture<ProjectApi>({
    findInternal: async () => {
      const id = tenantId();
      return id ? internalGovernanceProject(id) : null;
    },
  });
}

/** An organization owner whose settings carry the given support contact. */
export function createSupportContactOrganizations(
  supportContact: string | null,
): Pick<OrganizationApi, "getSettings"> {
  return createApiFixture<OrganizationApi>({
    getSettings: async ({ organizationId }) => ({
      id: organizationId,
      name: "Organization",
      slug: "organization",
      supportContact,
      presenceEnabled: false,
      traceSharingEnabled: false,
      primaryIntent: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3Bucket: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
  });
}

/**
 * The Activity Monitor read model over a suite's own Postgres connection and
 * ClickHouse endpoint; the governance project is read from the same double.
 */
export function createActivityMonitorTestService(options: {
  prisma: ActivityMonitorDatabase;
  clickhouse: GovernanceClickHouseResolver;
}): ActivityMonitorService {
  return ActivityMonitorService.create({
    repository: PrismaActivityMonitorRepository.create(options),
    projects: createApiFixture<ProjectApi>({
      findInternal: async ({ organizationId, kind }) => {
        const project = await options.prisma.project.findFirst({
          where: { kind, team: { organizationId }, archivedAt: null },
          select: { id: true },
        });
        return project ? internalGovernanceProject(project.id) : null;
      },
    }),
  });
}

/** The department directory over a suite's own Postgres connection. */
export function createDepartmentTestService(
  database: DepartmentDatabase,
  organizations: DepartmentOrganizations,
  projects: DepartmentProjects = createApiFixture<ProjectApi>({}),
): DepartmentService {
  return DepartmentService.create({
    repository: PrismaDepartmentRepository.create(database),
    organizations,
    projects,
  });
}
