/**
 * @vitest-environment node
 *
 * Who may probe a stored object. The renderer asks this procedure why a media
 * element failed, so the gate has to match the one the bytes themselves are
 * served behind (`app/api/files/[[...route]]/app.ts` accepts traces:view,
 * scenarios:view OR datasets:view). When it was narrower, a viewer who could
 * fetch a recording could not find out why its player failed, and the player
 * never left its loading state.
 *
 * The read route narrows again once it knows what the object IS, and so does
 * this probe: a viewer who holds only `datasets:view` reaches the service, but
 * a row kept as trace media is refused all the same.
 *
 * Real Postgres, real router, no mocks: each caller's only grant is an
 * explicit CUSTOM role binding, so a pass can only come from that grant.
 *
 * Spec: specs/traces-v2/media-rendering.feature
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { StoredObjectsRepository } from "~/server/stored-objects/stored-objects.repository";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { prisma } from "../../../db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import type { Permission } from "../../rbac";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

type Caller = ReturnType<typeof appRouter.createCaller>;

describe("storedObjects.headById: who may probe", () => {
  const ns = `soprobe-${nanoid(8)}`;
  const ORG = `org-${ns}`;
  const TEAM = `team-${ns}`;
  const PROJECT = `proj-${ns}`;
  let seq = 0;

  async function seedCaller(permissions: Permission[]): Promise<Caller> {
    const uid = `usr-${ns}-${seq++}`;
    const email = `${uid}@example.com`;
    await prisma.user.create({ data: { id: uid, email, name: uid } });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG,
        userId: uid,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const roleId = `crole-${uid}`;
    await prisma.customRole.create({
      data: {
        id: roleId,
        organizationId: ORG,
        name: roleId,
        permissions,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG,
        userId: uid,
        role: TeamUserRole.CUSTOM,
        customRoleId: roleId,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: PROJECT,
      },
    });
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: uid, email, name: uid },
          expires: new Date(Date.now() + 3_600_000).toISOString(),
        } as any,
      }),
    );
  }

  beforeAll(async () => {
    const containers = await startTestContainers();
    // headById reaches the stored-objects repository, which resolves its
    // client through getApp().clickhouse (two-door access) - the fixture
    // installs the App the seam expects.
    installClickHouseTestApp({
      resolveClient: async () => containers.clickHouseClient,
    });
    await prisma.organization.create({
      data: { id: ORG, name: ORG, slug: ORG },
    });
    await prisma.team.create({
      data: { id: TEAM, name: TEAM, slug: TEAM, organizationId: ORG },
    });
    await prisma.project.create({
      data: {
        id: PROJECT,
        name: PROJECT,
        slug: PROJECT,
        teamId: TEAM,
        language: "en",
        framework: "openai",
        apiKey: `key-${PROJECT}`,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await clearClickHouseTestApp();
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG } });
    await prisma.project.deleteMany({ where: { teamId: TEAM } });
    await prisma.team.deleteMany({ where: { organizationId: ORG } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG },
    });
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await stopTestContainers();
  });

  describe("given a viewer whose only grant is trace access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("answers the probe for a viewer holding traces:view", async () => {
      const caller = await seedCaller(["traces:view"]);

      const result = await caller.storedObjects.headById({
        projectId: PROJECT,
        id: `absent-${nanoid(6)}`,
      });

      // No row for this id, which is the honest answer; the point is that the
      // caller reached the service at all instead of being refused.
      expect(result).toEqual({ status: "not_found" });
    });
  });

  describe("given a viewer whose only grant is scenario access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("still answers the probe for a viewer holding scenarios:view", async () => {
      const caller = await seedCaller(["scenarios:view"]);

      const result = await caller.storedObjects.headById({
        projectId: PROJECT,
        id: `absent-${nanoid(6)}`,
      });

      expect(result).toEqual({ status: "not_found" });
    });
  });

  describe("given a viewer whose only grant is dataset access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("still answers the probe for a viewer holding datasets:view", async () => {
      const caller = await seedCaller(["datasets:view"]);

      const result = await caller.storedObjects.headById({
        projectId: PROJECT,
        id: `absent-${nanoid(6)}`,
      });

      expect(result).toEqual({ status: "not_found" });
    });
  });

  describe("given a stored object kept for one feature", () => {
    /**
     * The row is enough: the bytes are never fetched, so a storage address
     * that resolves to nothing answers "missing", which is past the gate this
     * asserts on.
     */
    async function seedObject({
      id,
      purpose,
    }: {
      id: string;
      purpose: string;
    }): Promise<void> {
      const now = new Date();
      await new StoredObjectsRepository().insert({
        projectId: PROJECT,
        row: {
          id,
          project_id: PROJECT,
          purpose,
          owner_kind: "test",
          owner_id: `owner-${id}`,
          media_type: "image/png",
          size_bytes: 3,
          sha256: id,
          storage_uri: `file:///tmp/${ns}/${id}`,
          created_at: now,
          inserted_at: now,
        },
      });
    }

    describe("when a viewer holding only dataset access probes trace media", () => {
      /** @scenario "A probe is refused when the object's own permission is missing" */
      it("refuses the probe, naming the permission the object asks for", async () => {
        const id = `trace-${nanoid(6)}`;
        await seedObject({ id, purpose: "trace_content" });
        const caller = await seedCaller(["datasets:view"]);

        await expect(
          caller.storedObjects.headById({ projectId: PROJECT, id }),
        ).rejects.toMatchObject({
          cause: {
            code: "permission_denied",
            meta: { permission: "traces:view" },
          },
        });
      });
    });

    describe("when a viewer holding only dataset access probes scenario media", () => {
      /** @scenario "A probe is refused when the object's own permission is missing" */
      it("refuses that probe too", async () => {
        const id = `scenario-${nanoid(6)}`;
        await seedObject({ id, purpose: "scenario_attachment" });
        const caller = await seedCaller(["datasets:view"]);

        await expect(
          caller.storedObjects.headById({ projectId: PROJECT, id }),
        ).rejects.toMatchObject({
          cause: {
            code: "permission_denied",
            meta: { permission: "scenarios:view" },
          },
        });
      });
    });

    describe("when a viewer holding only dataset access probes a dataset attachment", () => {
      /** @scenario "A probe is refused when the object's own permission is missing" */
      it("answers the probe", async () => {
        const id = `attachment-${nanoid(6)}`;
        await seedObject({ id, purpose: "dataset_attachment" });
        const caller = await seedCaller(["datasets:view"]);

        const result = await caller.storedObjects.headById({
          projectId: PROJECT,
          id,
        });

        expect(result).toEqual({ status: "missing", mediaType: "image/png" });
      });
    });
  });

  describe("given a viewer holding none of the media permissions", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("refuses the probe, naming the permission to ask for", async () => {
      const caller = await seedCaller(["prompts:view"]);

      await expect(
        caller.storedObjects.headById({
          projectId: PROJECT,
          id: `absent-${nanoid(6)}`,
        }),
      ).rejects.toMatchObject({
        cause: {
          code: "permission_denied",
          meta: { permission: "traces:view" },
        },
      });
    });
  });
});
