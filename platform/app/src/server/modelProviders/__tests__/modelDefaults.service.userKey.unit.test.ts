/**
 * The default-models write gate walks the CALLER's role bindings, so it needs
 * a user to walk them for. A project API key names only a project, and the
 * guard used to answer that with a plain `Error("Not authenticated")` that
 * collapsed to a 400.
 *
 * Both halves of that were wrong at the customer. The request WAS
 * authenticated, so the word sent an API caller to inspect a key that is
 * working, and a 400 reads as a malformed body. Found while driving the CLI
 * against a running stack: `model-default list` answered and
 * `model-default set` said "HTTP 400: Not authenticated" for the same key.
 *
 * The guard rejects before any database access, so a bogus `prisma` is safe
 * here — this path never reaches it.
 *
 * @see specs/model-providers/model-default-config-cascade.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { assertCanWriteScope } from "../modelDefaults.service";

const unusedPrisma = undefined as never;

describe("assertCanWriteScope", () => {
  describe("given a caller whose key carries a project but no user", () => {
    /** @scenario Saving with a key that names no user is refused with a handled error */
    it("refuses with a handled 403 that names the two ways forward", async () => {
      const error = await assertCanWriteScope(
        { prisma: unusedPrisma, session: null },
        "PROJECT",
        "project-1",
      ).then(
        () => null,
        (thrown: unknown) => thrown,
      );

      expect(HandledError.isHandled(error)).toBe(true);
      const handled = error as HandledError;
      expect(handled.code).toBe("model_default_user_key_required");
      expect(handled.httpStatus).toBe(403);
      expect(handled.message).toBe(
        "Default models are set per user, and this API key is not tied to one. Use a user API key, or change the default in settings.",
      );
      expect(handled.message).not.toMatch(/not authenticated/i);
    });

    /** @scenario Saving with a key that names no user is refused with a handled error */
    it("refuses the same way at every scope tier", async () => {
      for (const scopeType of ["ORGANIZATION", "TEAM", "PROJECT"] as const) {
        const error = await assertCanWriteScope(
          { prisma: unusedPrisma, session: null },
          scopeType,
          "scope-1",
        ).then(
          () => null,
          (thrown: unknown) => thrown,
        );

        expect((error as HandledError).code).toBe(
          "model_default_user_key_required",
        );
      }
    });
  });
});
