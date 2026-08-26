// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @vitest-environment node */

import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  type ScimCreateUserRequest,
  type ScimPatchRequest,
} from "@langwatch/enterprise-scim-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

const CORE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

describe("SCIM department auto-assignment", () => {
  const namespace = `scim-dept-${nanoid(8)}`;
  const organizationId = `org-${namespace}`;
  let requestApp: App;

  const createDepartment = (name: string) =>
    prisma.department.create({ data: { organizationId, name } });

  const createRequest = (
    email: string,
    costCenter: string | null | undefined,
  ): ScimCreateUserRequest => ({
    schemas: [CORE_SCHEMA],
    userName: email,
    name: { givenName: "Test", familyName: "User" },
    active: true,
    ...(costCenter === undefined
      ? {}
      : { [SCIM_ENTERPRISE_USER_SCHEMA]: { costCenter } }),
  });

  const membershipFor = async (email: string) => {
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    return prisma.organizationUser.findUniqueOrThrow({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
    });
  };

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: organizationId },
    });
    requestApp = createTestApp();
  }, 60_000);

  afterAll(async () => {
    await prisma.department.deleteMany({ where: { organizationId } });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { email: { contains: namespace } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await stopTestContainers();
  });

  it("assigns the named department from the enterprise costCenter", async () => {
    const engineering = await createDepartment("Engineering");
    const email = `${namespace}-eng@example.com`;

    await requestApp.scim.createUser({
      request: createRequest(email, "Engineering"),
      organizationId,
    });

    expect((await membershipFor(email)).departmentId).toBe(engineering.id);
  });

  it("creates an unknown department before assigning it", async () => {
    const email = `${namespace}-research@example.com`;

    await requestApp.scim.createUser({
      request: createRequest(email, "Research"),
      organizationId,
    });

    const department = await prisma.department.findFirstOrThrow({
      where: { organizationId, name: "Research", archivedAt: null },
    });
    expect((await membershipFor(email)).departmentId).toBe(department.id);
  });

  it("reassigns the member when costCenter changes", async () => {
    const marketing = await createDepartment("Marketing");
    const email = `${namespace}-move@example.com`;
    await requestApp.scim.createUser({
      request: createRequest(email, "Engineering"),
      organizationId,
    });
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    const patch: ScimPatchRequest = {
      schemas: [PATCH_SCHEMA],
      Operations: [
        {
          op: "replace",
          path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter`,
          value: "Marketing",
        },
      ],
    };

    await requestApp.scim.updateUser({
      id: user.id,
      organizationId,
      patchRequest: patch,
    });

    expect((await membershipFor(email)).departmentId).toBe(marketing.id);
  });

  it("clears the assignment when costCenter is removed", async () => {
    const email = `${namespace}-clear@example.com`;
    await requestApp.scim.createUser({
      request: createRequest(email, "Engineering"),
      organizationId,
    });
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    const patch: ScimPatchRequest = {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "remove", path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter` }],
    };

    await requestApp.scim.updateUser({
      id: user.id,
      organizationId,
      patchRequest: patch,
    });

    expect((await membershipFor(email)).departmentId).toBeNull();
  });
});
