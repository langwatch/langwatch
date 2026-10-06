/**
 * @vitest-environment node
 *
 * ADR-144 decision 5 on the projects REST API's writes. PATCH and DELETE
 * /api/projects/:id check their permission at the organisation, so an
 * organisation-tier custom role reaches every project, the aggregate
 * included. Only an organisation admin may rename or archive an aggregate;
 * for anyone else it reads as not found, as it does on GET.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  type Project,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { prisma } from "~/server/db";
import { seedCustomRole, seedRoleBinding } from "~/test-utils/authz-seeds";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { app } from "../[[...route]]/app";

wireDefaultTestApp(() => ({
  projects: new ProjectService(new PrismaProjectRepository(prisma)),
  organizations: realOrganizationService(prisma),
}));

const WRITE_PERMISSIONS = ["project:view", "project:update", "project:delete"];

describe("Feature: the projects REST API writes an aggregate only for an organisation admin", () => {
  let fixture: AggregateFixture;
  let aggregate: Project;
  let editorToken: string;
  let adminToken: string;

  const orgWideKey = async (userId: string) =>
    (
      await ApiKeyService.create(prisma).create({
        name: "aggregate writes",
        userId,
        createdByUserId: userId,
        organizationId: fixture.organizationId,
        permissionMode: "restricted",
        permissions: WRITE_PERMISSIONS,
        bindings: [
          {
            role: TeamUserRole.CUSTOM,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: fixture.organizationId,
          },
        ],
      })
    ).token;

  const send = (method: "PATCH" | "DELETE", token: string, id: string) =>
    app.request(`/api/projects/${id}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(method === "PATCH" && {
        body: JSON.stringify({ name: `renamed ${fixture.ns}` }),
      }),
    });

  beforeAll(async () => {
    fixture = await seedAggregateOrganization(prisma, {
      label: "agg-rest-writes",
    });
    aggregate = await fixture.makeAggregate("company-view");

    // A member who is not an admin, holding an organisation-tier custom role
    // that may edit and archive projects: the reach the route's own check
    // admits on every project of the organisation.
    const editor = await fixture.makeUser({
      handle: "editor",
      organizationRole: OrganizationUserRole.MEMBER,
    });
    const editorRole = await seedCustomRole(prisma, {
      organizationId: fixture.organizationId,
      name: `Project editor ${fixture.ns}`,
      permissions: WRITE_PERMISSIONS,
    });
    await seedRoleBinding(prisma, {
      organizationId: fixture.organizationId,
      userId: editor.id,
      role: TeamUserRole.CUSTOM,
      customRoleId: editorRole.id,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: fixture.organizationId,
    });

    editorToken = await orgWideKey(editor.id);
    adminToken = await orgWideKey(fixture.admin.id);
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  describe("given a key whose owner holds an organisation custom role but is not an admin", () => {
    describe("when it renames the aggregate", () => {
      it("is answered not found, though it renames an ordinary project", async () => {
        expect((await send("PATCH", editorToken, fixture.shared.id)).status).toBe(
          200,
        );
        expect((await send("PATCH", editorToken, aggregate.id)).status).toBe(
          404,
        );

        const stored = await prisma.project.findUniqueOrThrow({
          where: { id: aggregate.id },
          select: { name: true },
        });
        expect(stored.name).toBe(aggregate.name);
      });
    });

    describe("when it archives the aggregate", () => {
      it("is answered not found and the aggregate stays live", async () => {
        expect((await send("DELETE", editorToken, aggregate.id)).status).toBe(
          404,
        );

        const stored = await prisma.project.findUniqueOrThrow({
          where: { id: aggregate.id },
          select: { archivedAt: true },
        });
        expect(stored.archivedAt).toBeNull();
      });
    });
  });

  describe("given a key whose owner is an organisation admin", () => {
    describe("when it renames the aggregate", () => {
      it("renames it", async () => {
        expect((await send("PATCH", adminToken, aggregate.id)).status).toBe(
          200,
        );
      });
    });
  });
});
