/**
 * Test-only access for Governance characterization suites: the collaborators
 * a suite needs, built here. Repositories and services stay private to the
 * feature server — a suite states which substrates it has, not which classes to construct.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ProjectApi } from "@langwatch/project-contract";

import type { GovernanceClickHouseResolver } from "../app/governance.members.ts";
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

/**
 * The Activity Monitor read model over a suite's own Postgres connection and
 * ClickHouse endpoint.
 */
export function createActivityMonitorTestService(options: {
  prisma: ActivityMonitorDatabase;
  clickhouse: GovernanceClickHouseResolver;
}): ActivityMonitorService {
  return ActivityMonitorService.create(PrismaActivityMonitorRepository.create(options));
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
