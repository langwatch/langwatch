/**
 * Demo-org scope guard.
 *
 * Every demo seeding/reset task hits the production database. The cost of a
 * bug that touches a non-demo org is unbounded (data loss, customer-visible
 * mutations). This module is the single chokepoint that makes that
 * structurally impossible, even when the calling script is buggy.
 *
 * The contract:
 *
 *   1. The platform deploys `DEMO_ORG_IDS` into the runtime env (AWS Parameter
 *      Store / Lambda env). This is the allowlist of organization ids the
 *      seeding system is permitted to touch.
 *   2. Every entry point in the demo seeding code MUST go through one of the
 *      assertion helpers below before it issues any write.
 *   3. The guard refuses to operate when the allowlist is empty, malformed,
 *      or absent. There is no implicit-empty-allow-all branch.
 *
 * Tests pin: an off-list orgId throws synchronously; the assertion runs
 * BEFORE any DB read of org-scoped data; loadAndAssertDemoProject refuses
 * projects whose parent org is off-list.
 */

import type { PrismaClient, Project, Team, Organization } from "@prisma/client";

const ENV_VAR = "DEMO_ORG_IDS";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export class DemoScopeViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoScopeViolation";
  }
}

export class DemoScopeMisconfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoScopeMisconfigured";
  }
}

export type ProjectWithOrgChain = Project & {
  team: Team & { organization: Organization };
};

export function parseDemoOrgIdsEnv(rawValue: string | undefined): string[] {
  if (rawValue === undefined || rawValue.trim() === "") {
    throw new DemoScopeMisconfigured(
      `${ENV_VAR} is not set. Demo seeding refuses to run without an allowlist.`,
    );
  }

  const ids = rawValue
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (ids.length === 0) {
    throw new DemoScopeMisconfigured(
      `${ENV_VAR} is set but contains no usable ids after trimming.`,
    );
  }

  for (const id of ids) {
    if (!ID_PATTERN.test(id)) {
      throw new DemoScopeMisconfigured(
        `${ENV_VAR} contains malformed id ${JSON.stringify(id)}. ` +
          `Each id must match ${ID_PATTERN}.`,
      );
    }
  }

  const deduped = [...new Set(ids)];
  return deduped;
}

export function assertDemoOrgAllowed(
  organizationId: string,
  allowlist: readonly string[],
): void {
  if (!allowlist.includes(organizationId)) {
    throw new DemoScopeViolation(
      `Organization id ${JSON.stringify(organizationId)} is not in the demo ` +
        `allowlist. The seeding system refuses to touch it. ` +
        `If this is a new demo org, add its id to ${ENV_VAR}.`,
    );
  }
}

export class DemoOrgScope {
  private readonly allowlist: readonly string[];

  constructor(allowlist: readonly string[]) {
    if (allowlist.length === 0) {
      throw new DemoScopeMisconfigured(
        "DemoOrgScope refuses to construct from an empty allowlist.",
      );
    }
    this.allowlist = [...allowlist];
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): DemoOrgScope {
    return new DemoOrgScope(parseDemoOrgIdsEnv(env[ENV_VAR]));
  }

  getAllowlist(): readonly string[] {
    return this.allowlist;
  }

  assertOrgIdAllowed(organizationId: string): void {
    assertDemoOrgAllowed(organizationId, this.allowlist);
  }

  async loadOrg(
    prisma: PrismaClient,
    organizationId: string,
  ): Promise<Organization> {
    this.assertOrgIdAllowed(organizationId);
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (org === null) {
      throw new DemoScopeViolation(
        `Organization ${JSON.stringify(organizationId)} is in the allowlist ` +
          `but does not exist in the database.`,
      );
    }
    return org;
  }

  async loadProject(
    prisma: PrismaClient,
    projectId: string,
  ): Promise<ProjectWithOrgChain> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { include: { organization: true } } },
    });
    if (project === null) {
      throw new DemoScopeViolation(
        `Project ${JSON.stringify(projectId)} not found.`,
      );
    }
    this.assertOrgIdAllowed(project.team.organization.id);
    return project as ProjectWithOrgChain;
  }
}
