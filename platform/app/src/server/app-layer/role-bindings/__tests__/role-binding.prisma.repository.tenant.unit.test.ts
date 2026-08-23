import type { AuthzService } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaRoleBindingRepository } from "../repositories/role-binding.prisma.repository";

const database = {} as PrismaClient;

describe("PrismaRoleBindingRepository tenant references", () => {
  it("routes synthesis reads through the AuthZ capability", async () => {
    const listBindingsForSynthesis = vi.fn().mockResolvedValue([]);
    const accessListing = {
      listBindingsForSynthesis,
    } as unknown as AuthzService;
    const repository = new PrismaRoleBindingRepository(database, accessListing);

    const bindings = await repository.listForOrganizationsAndUser({
      orgIds: ["org_1", "org_2"],
      userId: "user_1",
    });

    expect(bindings).toEqual([]);
    expect(listBindingsForSynthesis).toHaveBeenCalledWith({
      orgIds: ["org_1", "org_2"],
      userId: "user_1",
    });
  });

  it("routes team-member reads through the AuthZ capability", async () => {
    const expected = new Map();
    const listTeamMemberBindings = vi.fn().mockResolvedValue(expected);
    const accessListing = {
      listTeamMemberBindings,
    } as unknown as AuthzService;
    const repository = new PrismaRoleBindingRepository(database, accessListing);

    const result = await repository.listTeamScopedUserBindingsByTeamIds({
      organizationId: "org_1",
      teamIds: ["team_1"],
    });

    expect(result).toBe(expected);
    expect(listTeamMemberBindings).toHaveBeenCalledWith({
      organizationId: "org_1",
      teamIds: ["team_1"],
    });
  });
});
