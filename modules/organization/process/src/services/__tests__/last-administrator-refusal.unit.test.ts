/**
 * The one lockout nothing inside the product can undo: a directory that
 * deprovisions the last administrator who can sign in.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
} from "../../app/organization.members.ts";
import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { OrganizationMembershipService } from "../organization-membership.service.ts";

const ORGANIZATION = "org_acme";

let memory: MemoryOrganizationDatabase;
let service: OrganizationMembershipService;

function seedMember(userId: string, role: OrganizationUserRole, disabled = false): void {
  const now = new Date(0);
  memory.organizationUsers.push({
    userId,
    organizationId: ORGANIZATION,
    role,
    disabledAt: disabled ? now : null,
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(() => {
  memory = MemoryOrganizationDatabase.create();
  service = OrganizationMembershipService.create({
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
    prompts: createApiFixture<OrganizationPromptSeed>(),
    seats: createApiFixture<OrganizationSeatLicense>(),
    sessions: createApiFixture<OrganizationSessionRevocation>(),
    grantCache: createApiFixture<OrganizationGrantCache>(),
    testArrivals: { standingFor: async () => ({ testing: false }) as const },
    admissions: {
      attachBindings: () => Promise.reject(new Error("no admission expected")),
      completeAdmission: () => Promise.reject(new Error("no admission expected")),
    },
  });
});

describe("given a directory about to deprovision a member", () => {
  describe("when that member is the only administrator who can sign in", () => {
    /** @scenario "A directory cannot deactivate the last administrator who can still sign in" */
    it("refuses by name, so the organization keeps somebody who can let people back in", async () => {
      seedMember("user_ana", OrganizationUserRole.ADMIN);
      seedMember("user_ben", OrganizationUserRole.MEMBER);
      seedMember("user_cara", OrganizationUserRole.ADMIN, true);

      await expect(
        service.assertRemovalKeepsAnAdministrator({
          organizationId: ORGANIZATION,
          userId: "user_ana",
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });
    });
  });

  describe("when another administrator is left behind", () => {
    /** @scenario "A directory may deactivate an administrator while another can still get in" */
    it("answers nothing, because there is nothing to refuse", async () => {
      seedMember("user_ana", OrganizationUserRole.ADMIN);
      seedMember("user_ben", OrganizationUserRole.ADMIN);

      await expect(
        service.assertRemovalKeepsAnAdministrator({
          organizationId: ORGANIZATION,
          userId: "user_ana",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the member is not an administrator, or not a member at all", () => {
    it("lets both through: neither removal costs the organization an administrator", async () => {
      seedMember("user_ana", OrganizationUserRole.ADMIN);
      seedMember("user_ben", OrganizationUserRole.MEMBER);

      await expect(
        service.assertRemovalKeepsAnAdministrator({
          organizationId: ORGANIZATION,
          userId: "user_ben",
        }),
      ).resolves.toBeUndefined();
      await expect(
        service.assertRemovalKeepsAnAdministrator({
          organizationId: ORGANIZATION,
          userId: "user_nobody",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the last administrator is already disabled", () => {
    /** @scenario "An administrator who is already deactivated does not count as a way in" */
    it("lets the removal through: a disabled administrator cannot sign in either way", async () => {
      seedMember("user_ana", OrganizationUserRole.ADMIN, true);

      await expect(
        service.assertRemovalKeepsAnAdministrator({
          organizationId: ORGANIZATION,
          userId: "user_ana",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
