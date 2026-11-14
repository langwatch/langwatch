import { describe, expect, it, vi } from "vitest";

import { guardOrganizationId } from "../organization-guard.ts";

/** Nurturing's copies are read by the project id or by one organization, never fleet-wide. */
function guarded(model: string, action: string, where: Record<string, unknown>) {
  const next = vi.fn(async () => null);
  const read = guardOrganizationId({ model, action, args: { where } }, next);
  return { read, next };
}

describe.each(["NurturingPersonalProject", "NurturingTracedProject"])("a %s query", (model) => {
  it.each([
    ["one organization", { organizationId: "org-1" }],
    ["one project", { projectId: "project-1" }],
  ])("admits a read bounded to %s", async (_bound, where) => {
    const { read, next } = guarded(model, "findFirst", where);

    await expect(read).resolves.toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it("refuses a read with no organization or project", async () => {
    const { read, next } = guarded(model, "findFirst", { ownerUserId: "user-1" });

    await expect(read).rejects.toThrow(/organizationId/);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a read spanning two organizations", async () => {
    const { read, next } = guarded(model, "findMany", {
      OR: [{ organizationId: "org-1" }, { organizationId: "org-2" }],
    });

    await expect(read).rejects.toThrow(/multiple organizations/);
    expect(next).not.toHaveBeenCalled();
  });
});
