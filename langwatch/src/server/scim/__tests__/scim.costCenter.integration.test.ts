/**
 * @vitest-environment node
 *
 * SCIM enterprise-extension costCenter -> department auto-assignment,
 * against a real Postgres test container, no mocks. Binds the SCIM
 * scenarios of departments.feature.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ScimService } from "../scim.service";
import { SCIM_ENTERPRISE_USER_SCHEMA } from "../scim.types";
import type { ScimCreateUserRequest, ScimPatchRequest } from "../scim.types";

import { prisma } from "../../db";
import { DepartmentService } from "../../../../ee/governance/services/department/department.service";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";

const CORE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

describe("ScimService department auto-assignment", () => {
  const ns = `scim-dept-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;

  const scim = () => ScimService.create(prisma);
  const departments = () => DepartmentService.create(prisma);

  const createRequest = (
    email: string,
    costCenter: string | null | undefined,
  ): ScimCreateUserRequest => {
    const base: Record<string, unknown> = {
      schemas: [CORE_SCHEMA],
      userName: email,
      name: { givenName: "Test", familyName: "User" },
      active: true,
    };
    if (costCenter !== undefined) {
      base[SCIM_ENTERPRISE_USER_SCHEMA] = { costCenter };
    }
    return base as ScimCreateUserRequest;
  };

  const membershipFor = async (email: string) => {
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    return prisma.organizationUser.findUniqueOrThrow({
      where: {
        userId_organizationId: { userId: user.id, organizationId: ORG_ID },
      },
    });
  };

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: ns, slug: ORG_ID },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.department.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  describe("given an org that provisions users through SCIM", () => {
    /** @scenario A SCIM-provisioned user is assigned from the enterprise costCenter attribute */
    it("assigns the user to the named department carried on the enterprise extension", async () => {
      const engineering = await departments().create({
        organizationId: ORG_ID,
        name: "Engineering",
      });
      const email = `${ns}-eng@example.com`;

      await scim().createUser({
        request: createRequest(email, "Engineering"),
        organizationId: ORG_ID,
      });

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(engineering.id);
    });

    /** @scenario An unrecognized SCIM costCenter creates the department on first use */
    it("creates a department the first time SCIM references it, then assigns it", async () => {
      const email = `${ns}-research@example.com`;

      const before = await prisma.department.findFirst({
        where: { organizationId: ORG_ID, name: "Research", archivedAt: null },
      });
      expect(before).toBeNull();

      await scim().createUser({
        request: createRequest(email, "Research"),
        organizationId: ORG_ID,
      });

      const created = await prisma.department.findFirstOrThrow({
        where: { organizationId: ORG_ID, name: "Research", archivedAt: null },
      });
      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(created.id);
    });

    /** @scenario Updating the SCIM costCenter reassigns the user */
    it("replaces the prior assignment when the IdP updates the costCenter", async () => {
      const marketing = await departments().create({
        organizationId: ORG_ID,
        name: "Marketing",
      });
      const email = `${ns}-move@example.com`;
      await scim().createUser({
        request: createRequest(email, "Engineering"),
        organizationId: ORG_ID,
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
      await scim().updateUser({
        id: user.id,
        organizationId: ORG_ID,
        patchRequest: patch,
      });

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(marketing.id);
    });

    /** @scenario Clearing the SCIM costCenter unassigns the user */
    it("clears the assignment when the IdP removes the costCenter attribute", async () => {
      const email = `${ns}-clear@example.com`;
      await scim().createUser({
        request: createRequest(email, "Engineering"),
        organizationId: ORG_ID,
      });
      const user = await prisma.user.findFirstOrThrow({ where: { email } });

      const patch: ScimPatchRequest = {
        schemas: [PATCH_SCHEMA],
        Operations: [
          { op: "remove", path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter` },
        ],
      };
      await scim().updateUser({
        id: user.id,
        organizationId: ORG_ID,
        patchRequest: patch,
      });

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBeNull();
    });
  });
});
