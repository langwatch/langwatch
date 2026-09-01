/**
 * @vitest-environment node
 * @integration
 *
 * The v1 pull-request usage door at organization scale, on the authorization
 * engine — the production shape that broke: a service key on an engine
 * organization with dozens of projects answered a 10-second P2024 500,
 * because the key ceiling opened a database pass per project per permission
 * and the concurrent fan-out exhausted the connection pool before the pull
 * request was even looked up. The batched ceiling collects the key's grants
 * once; this suite proves the rollup answers, for every project, through the
 * real route. The query-count half of the scenario is pinned by
 * src/server/rbac/__tests__/resolveApiKeyPermissionProjectBatch.integration.test.ts
 * and the collect-once half by @langwatch/authz-server's own suite.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  type Team,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { resetApp } from "~/server/app-layer/app";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/engine-gate";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "~/server/app-layer/authz/migration-name";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { app } from "../[[...route]]/app.v1";
import { USAGE_PATH } from "./pullRequestUsageV1Harness";
import { installPullRequestUsageTestAppForTenants } from "./pullRequestUsageV1TestApp";

const ns = nanoid(8);
const PROJECT_COUNT = 30;

let organization: Organization;
let team: Team;
let projectIds: string[];
let serviceToken: string;
let serviceKeyId: string;

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `pr-usage-scale-${ns}`, slug: `--test-org-scale-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: `pr-usage-scale-${ns}`,
      slug: `--test-team-scale-${ns}`,
      organizationId: organization.id,
    },
  });
  const projects = await Promise.all(
    Array.from({ length: PROJECT_COUNT }, (_, index) =>
      prisma.project.create({
        data: {
          id: `project_${nanoid()}`,
          name: `Scale ${index}`,
          slug: `--test-scale-${index}-${ns}`,
          language: "typescript",
          framework: "other",
          apiKey: `sk-lw-${nanoid(48)}`,
          teamId: team.id,
          isPersonal: false,
        },
      }),
    ),
  );
  projectIds = projects.map((project) => project.id);

  await prisma.githubPullRequest.create({
    data: {
      organizationId: organization.id,
      repositoryHost: "github.com",
      repositoryFullName: "acme/widgets",
      headBranch: "feat/linkage",
      prNumber: 1,
      htmlUrl: "https://github.com/acme/widgets/pull/1",
      title: "Link sessions to pull requests",
      state: "open",
      isDraft: false,
      authorLogin: "acme-dev",
      prCreatedAt: new Date("2026-07-01T09:00:00Z"),
    },
  });

  // Minted while the organization is still legacy, so the default org-admin
  // binding lands imperatively rather than through the ledger machinery this
  // suite is not running. The migration to the engine is then stated the way
  // a finished one leaves it: the state row, the grant on the engine head,
  // and the gate cache dropped so the next read sees the cut-over.
  const minted = await ApiKeyService.create(prisma).create({
    name: `pr-usage-scale-${ns}`,
    userId: null,
    createdByUserId: null,
    organizationId: organization.id,
    permissionMode: "all",
    bindings: [],
  });
  serviceToken = minted.token;
  serviceKeyId = minted.apiKey.id;
  await prisma.systemMigrationTenantState.create({
    data: {
      migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
      tenantId: organization.id,
      status: "finalized",
      occurredAt: new Date(),
    },
  });
  await prisma.grant.create({
    data: {
      id: `grant_scale_${ns}`,
      organizationId: organization.id,
      principalType: GrantPrincipalType.API_KEY,
      principalId: serviceKeyId,
      roleKey: "admin",
      source: "migration",
      scopeType: GrantScopeType.ORGANIZATION,
      scopeId: organization.id,
      occurredAt: new Date(),
    },
  });
  resetAuthzEngineGateForTesting();

  installPullRequestUsageTestAppForTenants({
    organizationId: organization.id,
    tenantIds: projectIds,
  });
});

afterAll(async () => {
  await resetApp();
  await cleanupTestRows(prisma, [
    ["auditLog", { organizationId: organization.id }],
    ["grant", { organizationId: organization.id }],
    ["systemMigrationTenantState", { tenantId: organization.id }],
    ["roleBinding", { organizationId: organization.id }],
    ["apiKey", { organizationId: organization.id }],
    ["githubPullRequest", { organizationId: organization.id }],
    ["project", { teamId: team.id }],
    ["team", { id: team.id }],
    ["organization", { id: organization.id }],
  ]);
});

describe("Feature: Pull request usage v1 at organization scale", () => {
  describe("given an engine organization with dozens of projects and an org-wide service key", () => {
    describe("when the usage is read with that key", () => {
      /** @scenario "A large organization's rollup is decided from one grant snapshot" */
      it("answers every project's row and records the read against the key", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: { Authorization: `Bearer ${serviceToken}` },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(
          (body.rows as Array<{ projectId: string }>)
            .map((row) => row.projectId)
            .sort(),
        ).toEqual([...projectIds].sort());
        expect(body.totals.sessionsCount).toBe(PROJECT_COUNT);

        const recorded = await prisma.auditLog.findFirst({
          where: {
            organizationId: organization.id,
            action: "codingAgents.pullRequestUsage",
          },
        });
        expect(recorded?.userId).toBe(`apikey:${serviceKeyId}`);
        expect(recorded?.args).toMatchObject({
          contributingProjectCount: PROJECT_COUNT,
        });
      });
    });
  });
});
