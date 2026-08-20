/** @vitest-environment node */

/**
 * ADR-092 decision 25, the fail-closed half: every tRPC procedure either
 * declares its access decision (`.permission()`, `.permissionAny()`,
 * `.noPermission({ reason })`, `.authorizeInService({ … })`) or runs a
 * custom middleware that declared itself via `declareAuthzMiddleware`. This
 * walks the REAL router map, so a procedure added with a bare `.use()` and
 * no declaration fails the suite — the compile-time builder makes that hard,
 * and this makes it impossible to merge.
 *
 * `enforcePermissionCheck` already fails such a procedure at RUNTIME on its
 * first call; this sweep moves the discovery to CI, before any call exists.
 */
import { describe, expect, it } from "vitest";
import { authzDeclarationOf } from "~/server/app-layer/authz/declared-middleware";
import { appRouter } from "../root";

describe("tRPC authz declaration sweep", () => {
  describe("when enumerating every procedure's middleware chain", () => {
    /** @scenario "Every tRPC procedure declares its access decision or an explicit reason not to" */
    it("finds a declaration on every procedure", () => {
      const procedures = (
        appRouter as unknown as {
          _def: { procedures: Record<string, unknown> };
        }
      )._def.procedures;

      const undeclared = Object.entries(procedures)
        .filter(([, procedure]) => {
          const middlewares =
            (
              procedure as {
                _def?: { middlewares?: unknown[] };
              }
            )._def?.middlewares ?? [];
          return !middlewares.some(
            (middleware) => authzDeclarationOf(middleware) !== null,
          );
        })
        .map(([path]) => path)
        .sort();

      expect(undeclared).toEqual([]);
    });
  });
});
