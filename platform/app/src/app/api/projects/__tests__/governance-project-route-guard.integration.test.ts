/**
 * @vitest-environment node
 *
 * The hidden governance project is not a workspace, and the generic project
 * routes must say so. Before this guard existed the hiding invariant was
 * enforced only on the LIST surface: the project is filtered out of every
 * picker and listing, but `PATCH /api/projects/:id`, the archive route and the
 * key routes guarded personal projects and never looked at `kind` at all — so a
 * project nobody could see was one request away from being archived.
 *
 * Which matters because of WHICH id it is: this project's id is the ClickHouse
 * tenant every governance row is keyed by. Real Postgres, real app, no mocks.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 * Decision: ADR-128 §11
 */

import { PROJECT_KIND } from "@ee/governance/services/governanceProject.service";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { app } from "../[[...route]]/app";

wireDefaultTestApp();

describe("Feature: the governance project is refused by the generic project routes", () => {
  const ns = `gov-guard-${nanoid(8)}`;

  let organizationId: string;
  let teamId: string;
  let adminId: string;
  let token: string;
  let governanceProjectId: string;
  let ordinaryProjectId: string;

  const request = (
    path: string,
    init: { method: string; body?: unknown } = { method: "GET" },
  ) =>
    app.request(path, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Governance Guard Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: "Guard Team", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;

    const admin = await prisma.user.create({
      data: { name: "Guard Admin", email: `guard-admin-${ns}@example.com` },
    });
    adminId = admin.id;

    await prisma.organizationUser.create({
      data: {
        userId: adminId,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: adminId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    const governanceProject = await prisma.project.create({
      data: {
        name: "Governance (internal)",
        slug: `--test-governance-${ns}`,
        apiKey: `test-governance-${ns}`,
        teamId,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        language: "internal",
        framework: "governance",
      },
    });
    governanceProjectId = governanceProject.id;

    const ordinaryProject = await prisma.project.create({
      data: {
        name: "Ordinary Project",
        slug: `--test-ordinary-${ns}`,
        apiKey: `test-ordinary-${ns}`,
        teamId,
        language: "typescript",
        framework: "openai",
      },
    });
    ordinaryProjectId = ordinaryProject.id;

    token = (
      await ApiKeyService.create(prisma).create({
        name: `guard-${nanoid(6)}`,
        userId: adminId,
        createdByUserId: adminId,
        organizationId,
        // "all", the same mode the other projects REST tests use: it carries
        // every verb on the key itself, so authorization never falls through to
        // the authz engine, which this lane does not construct. The credential
        // is therefore never the thing that refuses — the guard is.
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      })
    ).token;
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["apiKey", { organizationId }],
      ["customRole", { organizationId }],
      ["project", { team: { organizationId } }],
      ["teamUser", { team: { organizationId } }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
    ]);
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  describe("given an organization's hidden governance area", () => {
    describe("when a request asks for it by id", () => {
      /** @scenario "Reading the governance area by its id reports it as absent" */
      it("is reported as not found, the way every listing already treats it", async () => {
        const response = await request(`/api/projects/${governanceProjectId}`);

        expect(response.status).toBe(404);
      });

      it("does not hand back its ingestion key either", async () => {
        const response = await request(
          `/api/projects/${governanceProjectId}/api-key`,
        );

        expect(response.status).toBe(404);
      });
    });

    describe("when a request tries to rename it", () => {
      /** @scenario "The governance area cannot be renamed or moved through the projects API" */
      it("is refused, and the name is unchanged", async () => {
        const response = await request(`/api/projects/${governanceProjectId}`, {
          method: "PATCH",
          body: { name: "Renamed By Accident" },
        });

        expect(response.status).toBe(403);
        const project = await prisma.project.findUnique({
          where: { id: governanceProjectId },
        });
        expect(project?.name).toBe("Governance (internal)");
      });
    });

    describe("when a request tries to archive it as if it were a project", () => {
      /** @scenario "The governance area cannot be archived through the projects API" */
      it("is refused, and the area stays live", async () => {
        const response = await request(`/api/projects/${governanceProjectId}`, {
          method: "DELETE",
        });

        expect(response.status).toBe(403);
        const project = await prisma.project.findUnique({
          where: { id: governanceProjectId },
        });
        expect(project?.archivedAt).toBeNull();
      });
    });

    describe("when a request tries to issue it a new key", () => {
      /** @scenario "The governance area cannot be re-keyed through the projects API" */
      it("is refused, and the key the receiver ingests under is unchanged", async () => {
        const response = await request(
          `/api/projects/${governanceProjectId}/regenerate-api-key`,
          { method: "POST" },
        );

        expect(response.status).toBe(404);
        const project = await prisma.project.findUnique({
          where: { id: governanceProjectId },
        });
        expect(project?.apiKey).toBe(`test-governance-${ns}`);
      });
    });
  });

  describe("given an ordinary project in the same organization", () => {
    describe("when it is renamed or read by id", () => {
      /** @scenario "An ordinary project is unaffected by the guard" */
      it("each request succeeds as before", async () => {
        const read = await request(`/api/projects/${ordinaryProjectId}`);
        expect(read.status).toBe(200);

        const renamed = await request(`/api/projects/${ordinaryProjectId}`, {
          method: "PATCH",
          body: { name: "Renamed On Purpose" },
        });
        expect(renamed.status).toBe(200);

        const project = await prisma.project.findUnique({
          where: { id: ordinaryProjectId },
        });
        expect(project?.name).toBe("Renamed On Purpose");
      });
    });
  });
});
