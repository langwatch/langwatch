import { describe, expect, it, vi } from "vitest";

import { guardOrganizationId } from "../organization-guard.ts";

/** Access notices carry people's addresses: every query names its organization or a row id. */
function guarded(action: string, where: Record<string, unknown>) {
  const next = vi.fn(async () => []);
  const read = guardOrganizationId(
    { model: "OrganizationAccessNotice", action, args: { where } },
    next,
  );
  return { read, next };
}

describe("an access notice query", () => {
  it.each([
    ["findMany", { mailedAt: null }],
    ["findFirst", { mailedAt: null, kind: "seat_request" }],
  ])("refuses a fleet-wide %s with no organization", async (action, where) => {
    const { read, next } = guarded(action, where);

    await expect(read).rejects.toThrow(/organizationId/);
    expect(next).not.toHaveBeenCalled();
  });

  it("admits a read bounded to one organization", async () => {
    const { read, next } = guarded("findMany", { organizationId: "org-1", mailedAt: null });

    await expect(read).resolves.toEqual([]);
    expect(next).toHaveBeenCalled();
  });

  it("admits the mailed mark by row id", async () => {
    const { read, next } = guarded("updateMany", { id: "notice-1", mailedAt: null });

    await expect(read).resolves.toEqual([]);
    expect(next).toHaveBeenCalled();
  });
});
