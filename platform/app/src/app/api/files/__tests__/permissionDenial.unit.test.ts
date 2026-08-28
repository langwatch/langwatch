/** @vitest-environment node */

/**
 * Telling a refusal apart from an outage, on the file-read route.
 *
 * This predicate decides 403-vs-5xx, and it used to decide it by comparing the
 * denial's message word for word:
 *
 *   err.message === "You do not have permission to access this project resource"
 *
 * which made a copy edit a silent behaviour change — reword that sentence and
 * every denial here quietly becomes a server fault, with nothing to catch it.
 * `code` is the stable half of a handled error precisely so control flow can
 * rest on it, and unlike `instanceof` it survives a serialisation boundary.
 *
 * The "outage" half matters just as much: masking a dropped connection as a 403
 * would tell the caller they lack access to a file they own.
 */
import { PermissionDeniedError } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import {
  LiteMemberRestrictedError,
  ProjectPermissionDeniedError,
} from "~/server/app-layer/permissions/errors";

import { isPermissionDenial } from "@langwatch/platform-api";

describe("isPermissionDenial", () => {
  describe("given a refusal from the permission layer", () => {
    /** @scenario "A denial is recognised without matching on its wording" */
    it("recognises a project permission denial by its code", () => {
      expect(isPermissionDenial(new ProjectPermissionDeniedError("traces:view"))).toBe(
        true,
      );
    });

    it("recognises a lite-member restriction", () => {
      expect(isPermissionDenial(new LiteMemberRestrictedError("traces"))).toBe(true);
    });

    // The ADR-092 engine denies with its own code. A route migrated to
    // `authz.authorize()` must still answer 403 rather than 500.
    it("recognises the unified engine's denial", () => {
      expect(
        isPermissionDenial(
          new PermissionDeniedError({
            permission: "traces:view",
            scope: { type: "project", id: "proj-1" },
            denialReason: "no-binding",
          }),
        ),
      ).toBe(true);
    });

    /**
     * The wording is copy and will change; the code will not. A denial whose
     * message has been rewritten must still be a denial.
     */
    it("does not depend on the wording", () => {
      const denial = new ProjectPermissionDeniedError("datasets:manage");
      denial.message = "Nope, ask an admin about datasets:manage";

      expect(isPermissionDenial(denial)).toBe(true);
    });
  });

  describe("given an infrastructure failure", () => {
    it("treats a dropped connection as an outage, not a refusal", () => {
      expect(isPermissionDenial(new Error("connection reset"))).toBe(false);
    });

    /**
     * The old predicate matched any `Error` carrying that one sentence, so a
     * failure that merely quoted it — a wrapper, a relayed body — was silently
     * downgraded to a 403.
     */
    it("does not accept a plain error that happens to say the old sentence", () => {
      expect(
        isPermissionDenial(
          new Error("You do not have permission to access this project resource"),
        ),
      ).toBe(false);
    });

    it("treats an unrelated handled error as an outage", () => {
      expect(isPermissionDenial({ code: "clickhouse_unavailable" })).toBe(false);
    });
  });
});
