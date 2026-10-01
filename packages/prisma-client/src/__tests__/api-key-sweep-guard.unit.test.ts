import {
  LANGY_SESSION_API_KEY_NAME,
  TRACE_EXPORT_API_KEY_NAME,
  WORKFLOW_RUN_API_KEY_NAME,
} from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import { guardOrganizationId } from "../organization-guard.ts";

const elapsed = { not: null, lte: new Date("2026-10-01T00:00:00.000Z") };

function sweep(where: Record<string, unknown>) {
  const next = vi.fn(async () => ({ count: 0 }));
  const swept = guardOrganizationId(
    { model: "ApiKey", action: "updateMany", args: { where, data: { revokedAt: new Date() } } },
    next,
  );

  return { swept, next };
}

describe("the cross-tenant sweep of system keys", () => {
  it.each([WORKFLOW_RUN_API_KEY_NAME, TRACE_EXPORT_API_KEY_NAME])(
    "admits a %s sweep that keeps to marked rows",
    async (name) => {
      const { swept, next } = sweep({
        name,
        revokedAt: null,
        expiresAt: elapsed,
        isSystemManaged: true,
      });

      await expect(swept).resolves.toEqual({ count: 0 });
      expect(next).toHaveBeenCalled();
    },
  );

  it.each([WORKFLOW_RUN_API_KEY_NAME, TRACE_EXPORT_API_KEY_NAME])(
    "refuses a %s sweep that could reach a customer's key of that name",
    async (name) => {
      const { swept, next } = sweep({ name, revokedAt: null, expiresAt: elapsed });

      await expect(swept).rejects.toThrow(/organizationId/);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it("admits a sweep of a name customers never could use, whose old rows carry no mark", async () => {
    const { swept } = sweep({
      name: LANGY_SESSION_API_KEY_NAME,
      revokedAt: null,
      expiresAt: elapsed,
    });

    await expect(swept).resolves.toEqual({ count: 0 });
  });
});
