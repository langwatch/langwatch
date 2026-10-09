import { describe, expect, it, vi } from "vitest";

import { guardOrganizationId } from "../organization-guard.ts";

/** The api-key module declares its sweeps as `@tenancy` SQL; the guard keeps no hatch for them. */
const elapsed = { not: null, lte: new Date("2026-10-01T00:00:00.000Z") };

function guarded(action: string, where: Record<string, unknown>) {
  const next = vi.fn(async () => ({ count: 0 }));
  const swept = guardOrganizationId({ model: "ApiKey", action, args: { where } }, next);
  return { swept, next };
}

describe("a cross-tenant sweep of API keys through the model API", () => {
  it.each([
    [
      "updateMany",
      { name: "Workflow run", revokedAt: null, expiresAt: elapsed, isSystemManaged: true },
    ],
    ["updateMany", { name: "Langy session", revokedAt: null, expiresAt: elapsed }],
    ["findMany", { name: { startsWith: "CLI login - " }, revokedAt: null, expiresAt: elapsed }],
  ])("refuses a %s with no organization", async (action, where) => {
    const { swept, next } = guarded(action, where);

    await expect(swept).rejects.toThrow(/organizationId/);
    expect(next).not.toHaveBeenCalled();
  });

  it("still admits a lookup by the globally-unique public token half", async () => {
    const { swept, next } = guarded("findUnique", { lookupId: "lookup-1" });

    await expect(swept).resolves.toEqual({ count: 0 });
    expect(next).toHaveBeenCalled();
  });
});
