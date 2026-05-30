import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScimRepository } from "../scim.repository";

vi.mock("@langwatch/ksuid", () => ({
  generate: () => ({ toString: () => "role-binding-id" }),
}));

function createMockPrisma() {
  const organizationUser = {
    create: vi.fn().mockReturnValue({ __op: "ou.create" }),
  };
  const roleBinding = {
    create: vi.fn().mockReturnValue({ __op: "rb.create" }),
  };
  const mock = {
    organizationUser,
    roleBinding,
    $transaction: vi.fn().mockResolvedValue([]),
  };
  return mock as unknown as Parameters<typeof ScimRepository.create>[0];
}

describe("ScimRepository", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repository: ScimRepository;

  beforeEach(() => {
    prisma = createMockPrisma();
    repository = ScimRepository.create(prisma);
  });

  describe("createMembership()", () => {
    describe("when scimManaged is not provided", () => {
      /** @scenario OrganizationUser model includes scimManaged field */
      it("creates the OrganizationUser row with scimManaged defaulting to false", async () => {
        await repository.createMembership({
          userId: "user-1",
          organizationId: "org-1",
        });

        expect(prisma.organizationUser.create).toHaveBeenCalledWith({
          data: {
            userId: "user-1",
            organizationId: "org-1",
            role: "MEMBER",
            scimManaged: false,
          },
        });
      });
    });

    describe("when scimManaged is provided as true", () => {
      it("creates the OrganizationUser row with scimManaged set to true", async () => {
        await repository.createMembership({
          userId: "user-1",
          organizationId: "org-1",
          scimManaged: true,
        });

        expect(prisma.organizationUser.create).toHaveBeenCalledWith({
          data: {
            userId: "user-1",
            organizationId: "org-1",
            role: "MEMBER",
            scimManaged: true,
          },
        });
      });
    });
  });
});
