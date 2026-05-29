/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 *
 * Proves the SecuredApp migration end-to-end against a real database:
 *   - a project API key WITHOUT the route's permission is forbidden (403) on
 *     every migrated route — the missing-authorization gaps the audit found are
 *     now enforced by construction;
 *   - an authorized key passes the gate;
 *   - a write route demands a write permission a read-only key lacks;
 *   - a key for one organization cannot resolve another organization's project
 *     (cross-tenant isolation at the token layer).
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Project,
  type Team,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";

import { app as analyticsApp } from "~/app/api/analytics/[...route]/app";
import { app as copilotkitApp } from "~/app/api/copilotkit/[[...route]]/app";
import { app as experimentsApp } from "~/app/api/experiments/[[...route]]/app";
import { app as modelDefaultsApp } from "~/app/api/model-defaults/[[...route]]/app";
import { app as modelProvidersApp } from "~/app/api/model-providers/[[...route]]/app";

const ns = `secured-rbac-${nanoid(8)}`;

let orgA: Organization;
let projectA1: Project;
let orgB: Organization;
let projectB1: Project;
let adminTokenA: string;
let readOnlyTokenA: string; // CUSTOM role, only traces:view
let workflowsViewerTokenA: string; // CUSTOM role, only workflows:view
let adminTokenB: string;

async function makeOrgWithProject(label: string) {
  const organization = await prisma.organization.create({
    data: { name: `${label} Org`, slug: `--test-org-${ns}-${label}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `${label} Team`,
      slug: `--test-team-${ns}-${label}`,
      organizationId: organization.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: `${label} Project`,
      slug: `--test-project-${ns}-${label}`,
      teamId: team.id,
      language: "python",
      framework: "openai",
      apiKey: `test-pkey-${ns}-${label}-${nanoid(6)}`,
    },
  });
  return { organization, team, project };
}

async function makeAdminUser(organization: Organization, team: Team) {
  const user = await prisma.user.create({
    data: { name: `User ${ns}`, email: `user-${ns}-${nanoid(6)}@example.com` },
  });
  await prisma.organizationUser.create({
    data: {
      userId: user.id,
      organizationId: organization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });
  await prisma.teamUser.create({
    data: { userId: user.id, teamId: team.id, role: TeamUserRole.ADMIN },
  });
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: organization.id,
      userId: user.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });
  return user;
}

beforeAll(async () => {
  const a = await makeOrgWithProject("A");
  orgA = a.organization;
  projectA1 = a.project;
  const b = await makeOrgWithProject("B");
  orgB = b.organization;
  projectB1 = b.project;

  const userA = await makeAdminUser(orgA, a.team);
  const userB = await makeAdminUser(orgB, b.team);

  const apiKeyService = ApiKeyService.create(prisma);

  const admin = await apiKeyService.create({
    name: `admin-${ns}`,
    userId: userA.id,
    createdByUserId: userA.id,
    organizationId: orgA.id,
    permissionMode: "all",
    bindings: [
      { role: TeamUserRole.ADMIN, scopeType: "PROJECT", scopeId: projectA1.id },
    ],
  });
  adminTokenA = admin.token;

  const readOnly = await apiKeyService.create({
    name: `readonly-${ns}`,
    userId: userA.id,
    createdByUserId: userA.id,
    organizationId: orgA.id,
    permissionMode: "restricted",
    permissions: ["traces:view"], // deliberately lacks project/analytics/evaluations/prompts view
    bindings: [
      { role: TeamUserRole.CUSTOM, scopeType: "PROJECT", scopeId: projectA1.id },
    ],
  });
  readOnlyTokenA = readOnly.token;

  const workflowsViewer = await apiKeyService.create({
    name: `workflows-viewer-${ns}`,
    userId: userA.id,
    createdByUserId: userA.id,
    organizationId: orgA.id,
    permissionMode: "restricted",
    permissions: ["workflows:view"], // can view experiments list, but NOT evaluations:view
    bindings: [
      { role: TeamUserRole.CUSTOM, scopeType: "PROJECT", scopeId: projectA1.id },
    ],
  });
  workflowsViewerTokenA = workflowsViewer.token;

  const adminB = await apiKeyService.create({
    name: `adminB-${ns}`,
    userId: userB.id,
    createdByUserId: userB.id,
    organizationId: orgB.id,
    permissionMode: "all",
    bindings: [
      { role: TeamUserRole.ADMIN, scopeType: "PROJECT", scopeId: projectB1.id },
    ],
  });
  adminTokenB = adminB.token;
}, 120_000);

afterAll(async () => {
  await prisma.project
    .deleteMany({ where: { slug: { contains: ns } } })
    .catch(() => {});
  await prisma.team
    .deleteMany({ where: { slug: { contains: ns } } })
    .catch(() => {});
  await prisma.organization
    .deleteMany({ where: { slug: { contains: ns } } })
    .catch(() => {});
  await prisma.user
    .deleteMany({ where: { email: { contains: ns } } })
    .catch(() => {});
});

const headers = (token: string, projectId: string) => ({
  Authorization: `Bearer ${token}`,
  "X-Project-Id": projectId,
  "Content-Type": "application/json",
});

describe("Feature: migrated Hono apps enforce RBAC + tenant isolation", () => {
  describe("when a project key lacks the route's permission", () => {
    /** @scenario "A project API key lacking the required permission is forbidden" */
    it("forbids GET /api/model-providers (requires project:view)", async () => {
      const res = await modelProvidersApp.request("/api/model-providers", {
        headers: headers(readOnlyTokenA, projectA1.id),
      });
      expect(res.status).toBe(403);
    });

    it("forbids POST /api/analytics/timeseries (requires analytics:view)", async () => {
      const res = await analyticsApp.request("/api/analytics/timeseries", {
        method: "POST",
        headers: headers(readOnlyTokenA, projectA1.id),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });

    it("forbids GET /api/experiments (requires workflows:view)", async () => {
      const res = await experimentsApp.request("/api/experiments", {
        headers: headers(readOnlyTokenA, projectA1.id),
      });
      expect(res.status).toBe(403);
    });

    it("forbids POST /api/copilotkit (requires prompts:view)", async () => {
      const res = await copilotkitApp.request("/api/copilotkit", {
        method: "POST",
        headers: headers(readOnlyTokenA, projectA1.id),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });

    it("forbids GET /api/model-defaults (requires project:view)", async () => {
      const res = await modelDefaultsApp.request("/api/model-defaults", {
        headers: headers(readOnlyTokenA, projectA1.id),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("when a project key holds only read permissions", () => {
    /** @scenario "A read-only key cannot perform a write action" */
    it("forbids the write route PUT /api/model-providers/:provider (requires project:update)", async () => {
      const res = await modelProvidersApp.request(
        "/api/model-providers/openai",
        {
          method: "PUT",
          headers: headers(readOnlyTokenA, projectA1.id),
          body: JSON.stringify({ enabled: true }),
        },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("when a project key holds the required permission", () => {
    /** @scenario "An authorized key passes the permission gate" */
    it("passes the gate on GET /api/model-providers (not 401/403)", async () => {
      const res = await modelProvidersApp.request("/api/model-providers", {
        headers: headers(adminTokenA, projectA1.id),
      });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it("passes the gate on GET /api/model-defaults (not 401/403)", async () => {
      const res = await modelDefaultsApp.request("/api/model-defaults", {
        headers: headers(adminTokenA, projectA1.id),
      });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    // Guards against a permission regression: GET /api/experiments mirrors the
    // canonical tRPC experiments-list procedures (workflows:view). A key that
    // can view workflows but lacks evaluations:view must still list experiments
    // — gating on the wrong permission would 403 it.
    it("lets a workflows:view-only key list experiments (not 403)", async () => {
      const res = await experimentsApp.request("/api/experiments", {
        headers: headers(workflowsViewerTokenA, projectA1.id),
      });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe("when targeting a model-defaults config that has no scope attachments", () => {
    // An orphan/unknown config resolves to zero scope attachments, so the
    // per-scope write check never runs. The handler must 404 rather than let
    // any authenticated caller mutate it. This also pins the error-mapping bug
    // where the catch block downgraded the typed 404 to a generic 400.

    /** @scenario "A model-defaults config with no scope attachments is treated as not found" */
    it("returns 404 (not 400) on PUT to an unknown config id", async () => {
      const res = await modelDefaultsApp.request(
        "/api/model-defaults/cfg_does_not_exist",
        {
          method: "PUT",
          headers: headers(adminTokenA, projectA1.id),
          body: JSON.stringify({ config: {} }),
        },
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 (not 400) on DELETE to an unknown config id", async () => {
      const res = await modelDefaultsApp.request(
        "/api/model-defaults/cfg_does_not_exist",
        {
          method: "DELETE",
          headers: headers(adminTokenA, projectA1.id),
        },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("when a key from another organization targets this project", () => {
    /** @scenario "A key for one organization cannot resolve another organization's project" */
    it("cannot resolve the cross-tenant project (401)", async () => {
      const res = await modelProvidersApp.request("/api/model-providers", {
        headers: headers(adminTokenB, projectA1.id),
      });
      expect(res.status).toBe(401);
    });
  });
});
