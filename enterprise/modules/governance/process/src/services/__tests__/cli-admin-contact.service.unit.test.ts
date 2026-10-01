// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { OrganizationCliAdminContactService } from "../cli-admin-contact.service.ts";

describe("OrganizationCliAdminContactService", () => {
  describe("when the organization has an enabled admin with an email", () => {
    it("answers that admin's email", async () => {
      const listMembers: Pick<OrganizationApi, "listMembers">["listMembers"] = vi
        .fn()
        .mockResolvedValue({
          members: [
            { role: "MEMBER", user: { id: "u1", name: null, email: "member@example.com" } },
            { role: "ADMIN", user: { id: "u2", name: null, email: "admin@example.com" } },
          ],
          totalCount: 2,
        });
      const organizations: Pick<OrganizationApi, "listMembers"> = { listMembers };
      const contacts = OrganizationCliAdminContactService.create(organizations);

      const email = await contacts.findAdminEmail("org_1");

      expect(listMembers).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_1" }),
      );
      expect(email).toBe("admin@example.com");
    });
  });

  describe("when the organization has no admin with an email", () => {
    it("answers null", async () => {
      const listMembers: Pick<OrganizationApi, "listMembers">["listMembers"] = vi
        .fn()
        .mockResolvedValue({ members: [], totalCount: 0 });
      const organizations: Pick<OrganizationApi, "listMembers"> = { listMembers };
      const contacts = OrganizationCliAdminContactService.create(organizations);

      const email = await contacts.findAdminEmail("org_1");

      expect(email).toBeNull();
    });
  });
});
