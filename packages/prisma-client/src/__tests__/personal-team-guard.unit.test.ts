import { describe, expect, it, vi } from "vitest";

import { guardOrganizationId } from "../organization-guard.ts";

/** A person's own personal teams are read across organizations; any other Team query names one. */
function guarded(action: string, where: Record<string, unknown>) {
  const next = vi.fn(async () => []);
  const query = guardOrganizationId({ model: "Team", action, args: { where } }, next);
  return { query, next };
}

describe("a Team query", () => {
  describe("when it reads one named owner's personal teams", () => {
    it.each(["findMany", "findFirst", "count"])("admits the %s", async (action) => {
      const { query, next } = guarded(action, { ownerUserId: "user-1", isPersonal: true });

      await expect(query).resolves.toEqual([]);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("when it writes by owner alone", () => {
    it.each(["updateMany", "deleteMany"])("refuses the %s", async (action) => {
      const { query, next } = guarded(action, { ownerUserId: "user-1", isPersonal: true });

      await expect(query).rejects.toThrow(/organizationId/);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when it names no organization, row or personal owner", () => {
    it.each([
      ["no predicate", {}],
      ["an owner without isPersonal", { ownerUserId: "user-1" }],
      ["isPersonal without an owner", { isPersonal: true }],
      ["an empty owner", { ownerUserId: "", isPersonal: true }],
      ["a loose isPersonal", { ownerUserId: "user-1", isPersonal: { not: false } }],
      ["a list of owners", { ownerUserId: { in: ["user-1", "user-2"] }, isPersonal: true }],
      ["a slug alone", { slug: "personal-sam" }],
    ])("refuses a findMany with %s", async (_shape, where) => {
      const { query, next } = guarded("findMany", where);

      await expect(query).rejects.toThrow(/organizationId/);
      expect(next).not.toHaveBeenCalled();
    });
  });

  it("admits a read bounded to one organization", async () => {
    const { query, next } = guarded("findMany", { organizationId: "org-1" });

    await expect(query).resolves.toEqual([]);
    expect(next).toHaveBeenCalled();
  });
});
