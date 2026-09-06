/** @vitest-environment node */

/**
 * The imperative facade's two families: `probe*` answers a boolean for call
 * sites that genuinely branch; `require*` throws the engine's denial and, on
 * success, returns the Authorized witness — the proof object a downstream
 * function can demand instead of a raw id, which is what turns "forgot the
 * permission check" into a missing-argument compile error.
 *
 * specs/rbac/typed-permission-declarations.feature is the behavioural
 * contract these pin.
 */
import type { Authorized } from "@langwatch/authz/witness";
import { describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import {
  probeProjectPermission,
  requireOrganizationPermission,
  requireProjectPermission,
} from "../imperative";

const SESSION = { user: { id: "user_1" } } as unknown as Session;

function appDeciding(permitted: boolean): App {
  return {
    permissions: {
      getDecision: vi.fn().mockResolvedValue({
        permitted,
        organizationRole: null,
      }),
    },
  } as unknown as App;
}

describe("the imperative permission facade", () => {
  describe("given a caller the engine permits", () => {
    /** @scenario "A passing imperative check returns a proof, not a boolean" */
    it("returns the witness for the decided tier and id", async () => {
      const authz = await requireProjectPermission(
        { session: SESSION, app: appDeciding(true) },
        "project_1",
        "traces:view",
      );

      expect(authz.scope).toEqual({ tier: "project", id: "project_1" });
      expect(authz.permission).toBe("traces:view");

      // The witness is what a downstream function demands in place of a raw
      // id — this call shape is the adoption contract.
      const reads = (proof: Authorized<"project">) => proof.scope.id;
      expect(reads(authz)).toBe("project_1");
    });
  });

  describe("given a caller the engine refuses", () => {
    /** @scenario "An imperative denial throws before the caller can continue" */
    it("throws the engine's one denial, code first", async () => {
      await expect(
        requireOrganizationPermission(
          { session: SESSION, app: appDeciding(false) },
          "org_1",
          "organization:manage",
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });
    });

    it("denies an unauthenticated context before reading any id", async () => {
      const app = appDeciding(true);

      await expect(
        requireProjectPermission(
          { session: null, app },
          "project_1",
          "traces:view",
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });
      expect(app.permissions.getDecision).not.toHaveBeenCalled();
    });
  });

  describe("given a call site that genuinely branches", () => {
    it("probes without throwing, and says so in its name", async () => {
      await expect(
        probeProjectPermission(
          { session: SESSION, app: appDeciding(false) },
          "project_1",
          "cost:view",
        ),
      ).resolves.toBe(false);
    });
  });
});
