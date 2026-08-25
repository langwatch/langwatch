/**
 * @vitest-environment node
 *
 * REST coverage for GET /api/secrets/by-name/:name/value, the one secrets
 * route that returns a value. Real Postgres, real Prisma, real Hono pipeline.
 *
 * Spec: specs/secrets/secret-value-read.feature
 */

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { RESERVED_PROJECT_SECRET_NAMES } from "~/server/projects/reserved-secret-names";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { encrypt } from "~/utils/encryption";
import { app } from "../[[...route]]/app";

wireDefaultTestApp();

const SESSION_SECRET_NAME = "ACME_SESSION";
const SESSION_VALUE = '{"session":"session-1","issued_at":1}';

describe("Feature: reading a project secret value", () => {
  const ns = `secret-value-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let projectId: string;
  let projectApiKey: string;
  let manageToken: string;
  let viewOnlyToken: string;
  let userId: string;

  const readValue = (name: string, token: string) =>
    app.request(`/api/secrets/by-name/${name}/value`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Project-Id": projectId,
      },
    });

  const storeSecret = async (name: string, encryptedValue: string) => {
    await prisma.projectSecret.create({
      data: {
        projectId,
        name,
        encryptedValue,
        createdById: userId,
        updatedById: userId,
      },
    });
  };

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Secret Value Org", slug: `--test-org-${ns}` },
    });
    testTeam = await prisma.team.create({
      data: {
        name: "Secret Value Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    const user = await prisma.user.create({
      data: { name: "Test User", email: `test-${ns}@example.com` },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId, teamId: testTeam.id, role: TeamUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: testOrganization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });

    projectApiKey = `sk-lw-${nanoid(48)}`;
    const project = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "Secret Value Project",
        slug: `--test-project-${ns}`,
        language: "typescript",
        framework: "other",
        apiKey: projectApiKey,
        teamId: testTeam.id,
      },
    });
    projectId = project.id;

    const apiKeyService = ApiKeyService.create(prisma);
    manageToken = (
      await apiKeyService.create({
        name: `secret-value-manage-${nanoid(6)}`,
        userId,
        createdByUserId: userId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    // A VIEWER binding resolves secrets:view and not secrets:manage, which is
    // exactly the caller this route has to refuse.
    viewOnlyToken = (
      await apiKeyService.create({
        name: `secret-value-view-${nanoid(6)}`,
        userId,
        createdByUserId: userId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    await storeSecret(SESSION_SECRET_NAME, encrypt(SESSION_VALUE));
    await storeSecret("ACME_BROKEN", "not-a-valid-envelope");
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["projectSecret", { projectId }],
      ["roleBinding", { organizationId: testOrganization.id }],
      ["apiKey", { organizationId: testOrganization.id }],
      ["project", { id: projectId }],
      ["teamUser", { teamId: testTeam.id }],
      ["organizationUser", { organizationId: testOrganization.id }],
      ["team", { id: testTeam.id }],
      ["organization", { id: testOrganization.id }],
      ["user", { id: userId }],
    ]);
  });

  describe("given a caller that can manage secrets", () => {
    /** @scenario "A stored secret is read back by its name" */
    it("reads the stored value back by name", async () => {
      const res = await readValue(SESSION_SECRET_NAME, manageToken);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        name: string;
        value: string;
        updatedAt: string;
      };
      expect(body.name).toBe(SESSION_SECRET_NAME);
      expect(body.value).toBe(SESSION_VALUE);
      expect(Date.parse(body.updatedAt)).not.toBeNaN();
    });

    it("reads the value with a legacy project API key", async () => {
      // The key a code agent carries. It holds full project access by design,
      // so it must pass the manage grain this route requires.
      const res = await app.request(
        `/api/secrets/by-name/${SESSION_SECRET_NAME}/value`,
        { headers: { "X-Auth-Token": projectApiKey } },
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { value: string }).value).toBe(
        SESSION_VALUE,
      );
    });

    /** @scenario "A name the project does not hold is refused as not found" */
    it("refuses an unknown name with the secret_not_found code", async () => {
      const res = await readValue("ACME_NOT_STORED", manageToken);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error?: string }).error).toBe(
        "secret_not_found",
      );
    });

    /** @scenario "A product-owned secret is refused as not found" */
    it("refuses a product-owned secret with the secret_not_found code", async () => {
      const reserved = RESERVED_PROJECT_SECRET_NAMES[0];
      expect(reserved).toBeDefined();
      await storeSecret(reserved!, encrypt("product-owned"));

      const res = await readValue(reserved!, manageToken);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error?: string }).error).toBe(
        "secret_not_found",
      );
    });

    it("refuses a value it cannot decrypt with the secret_value_unreadable code", async () => {
      const res = await readValue("ACME_BROKEN", manageToken);
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error?: string }).error).toBe(
        "secret_value_unreadable",
      );
    });
  });

  describe("given a caller that cannot manage secrets", () => {
    /** @scenario "A caller that can only view secrets cannot read a value" */
    it("refuses a caller that holds only secrets:view", async () => {
      const res = await readValue(SESSION_SECRET_NAME, viewOnlyToken);
      expect(res.status).toBe(403);
    });

    /** @scenario "A request without an API key is refused" */
    it("refuses a request that carries no API key", async () => {
      const res = await app.request(
        `/api/secrets/by-name/${SESSION_SECRET_NAME}/value`,
        { headers: { "X-Project-Id": projectId } },
      );
      expect(res.status).toBe(401);
    });
  });
});
