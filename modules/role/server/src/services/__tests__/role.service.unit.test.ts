import { ROLE_KIND, RoleNotFoundError, type Role } from "@langwatch/role-contract";
import { describe, expect, it } from "vitest";
import { MemoryRoleRepository } from "../../repositories/memory/memory.role.repository.ts";
import { RoleService } from "../role.service.ts";

const role = (overrides: Partial<Role> = {}): Role => ({
  id: "role-1",
  organizationId: "org-1",
  name: "Reviewer",
  description: null,
  permissions: ["traces:view"],
  kind: ROLE_KIND.CUSTOM,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

function serviceWith(...roles: Role[]) {
  const repository = MemoryRoleRepository.create();
  for (const stored of roles) repository.save(stored);

  return { service: RoleService.create({ repository }), repository };
}

describe("given a stored custom role", () => {
  describe("when it is read by id", () => {
    it("answers the definition", async () => {
      const { service } = serviceWith(role());

      await expect(service.getById({ roleId: "role-1" })).resolves.toMatchObject({
        name: "Reviewer",
      });
    });
  });

  describe("when the id names a system role the mint owns", () => {
    it("reads as absent", async () => {
      const { service } = serviceWith(role({ kind: ROLE_KIND.SYSTEM_API_KEY }));

      await expect(service.getById({ roleId: "role-1" })).rejects.toBeInstanceOf(
        RoleNotFoundError,
      );
    });
  });
});

describe("given a name the API-key mint reserves", () => {
  describe("when a caller uses it for a role of their own", () => {
    it("refuses with the reserved-name code", () => {
      const { service } = serviceWith();

      expect(() => service.assertNameAllowed("apikey:deploy")).toThrowError(
        expect.objectContaining({ code: "custom_role_name_reserved" }),
      );
      expect(() => service.assertNameAllowed("Reviewer")).not.toThrow();
    });
  });
});

describe("given a name another role in the organization holds", () => {
  describe("when a second role claims it", () => {
    it("refuses, and lets the holder keep its own name", async () => {
      const { service } = serviceWith(role());

      await expect(
        service.assertNameAvailable({ organizationId: "org-1", name: "Reviewer" }),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });

      await expect(
        service.assertNameAvailable({
          organizationId: "org-1",
          name: "Reviewer",
          exceptRoleId: "role-1",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given roles from two organizations", () => {
  describe("when one organization asks which of them it may assign", () => {
    it("answers with its own only, and with nothing for an empty ask", async () => {
      const { service } = serviceWith(
        role(),
        role({ id: "role-2", organizationId: "org-2", name: "Other" }),
      );

      await expect(
        service.filterAssignable({ roleIds: ["role-1", "role-2"], organizationId: "org-1" }),
      ).resolves.toEqual(["role-1"]);
      await expect(
        service.filterAssignable({ roleIds: [], organizationId: "org-1" }),
      ).resolves.toEqual([]);
    });
  });
});
