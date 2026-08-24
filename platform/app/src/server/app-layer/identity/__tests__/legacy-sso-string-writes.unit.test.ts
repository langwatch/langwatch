/** @vitest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "~/env.mjs";
import { explainHandledError } from "~/features/errors/logic/presentation";
import {
  assertLegacySsoStringWriteAllowed,
  legacySsoStringColumnsIn,
  legacySsoStringWritesRetired,
} from "../legacy-sso-string-writes";

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return { ...actual, env: { ...actual.env, SSOCONN_ROUTING: "off" } };
});

const envMock = env as unknown as { SSOCONN_ROUTING: string };

const REPO_ROOT = join(import.meta.dirname, "../../../../../../..");

afterEach(() => {
  envMock.SSOCONN_ROUTING = "off";
});

describe("the legacy sso string columns", () => {
  describe("given the connection routing flag is off or in shadow", () => {
    /** @scenario "After the flip, the strings stop being written" */
    it("keeps accepting edits, because the strings still decide sign-in", () => {
      for (const mode of ["off", "shadow"]) {
        envMock.SSOCONN_ROUTING = mode;
        expect(legacySsoStringWritesRetired()).toBe(false);
        expect(() =>
          assertLegacySsoStringWriteAllowed({
            data: { ssoDomain: "acme.com", ssoProvider: "okta" },
          }),
        ).not.toThrow();
      }
    });
  });

  describe("given the connection routing flag is enforced", () => {
    /** @scenario "After the flip, the strings stop being written" */
    it("refuses a string edit and names the columns that are now derived", () => {
      envMock.SSOCONN_ROUTING = "enforce";

      expect(legacySsoStringWritesRetired()).toBe(true);
      expect(() =>
        assertLegacySsoStringWriteAllowed({
          data: { name: "Acme", ssoDomain: "acme.com" },
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "sso_connection_string_edit_retired",
        }),
      );
      expect(
        legacySsoStringColumnsIn({
          ssoDomain: "acme.com",
          ssoProvider: "okta",
        }),
      ).toEqual(["ssoDomain", "ssoProvider"]);
    });

    /** @scenario "The old single sign-on fields stop being where single sign-on is set up" */
    it("points the reader at the organization's connection instead", () => {
      envMock.SSOCONN_ROUTING = "enforce";

      const refusal = (() => {
        try {
          assertLegacySsoStringWriteAllowed({
            data: { ssoProvider: "okta" },
          });
          return null;
        } catch (error) {
          return error as { code: string };
        }
      })();
      expect(refusal?.code).toBe("sso_connection_string_edit_retired");

      // The words a reader actually sees come from the registry keyed by the
      // code, never from the error's own message — which for a handled error
      // on the wire IS the code. They have to send the reader somewhere.
      const copy = explainHandledError({
        code: "sso_connection_string_edit_retired",
        meta: {},
        httpStatus: 409,
        fault: "customer",
        tips: [],
        docsUrl: undefined,
        traceId: undefined,
        reasons: [],
      });
      expect(copy.isRegistered).toBe(true);
      expect(copy.description).toMatch(/connection/i);
      expect(copy.description).not.toMatch(/sso_connection_string_edit/);
    });

    /** @scenario "After the flip, the strings stop being written" */
    it("leaves every other organization edit alone", () => {
      envMock.SSOCONN_ROUTING = "enforce";

      expect(() =>
        assertLegacySsoStringWriteAllowed({
          data: { name: "Acme", presenceEnabled: false },
        }),
      ).not.toThrow();
      expect(() =>
        assertLegacySsoStringWriteAllowed({ data: undefined }),
      ).not.toThrow();
    });
  });

  describe("given a connection changes after the flip", () => {
    /**
     * The other half of "only connection commands change it": a projection
     * row is written by the FOLD and by nothing else. A hand-written row is
     * not a configuration change — the next event or the next replay
     * overwrites it — so a second writer would be a silent way to make a
     * connection appear to have a state its history never gave it.
     *
     * Enforced by scanning the source rather than by convention, because the
     * failure mode is somebody adding the write later in good faith.
     *
     * @scenario "After the flip, the strings stop being written"
     */
    it("has exactly one writer of the SsoConnection table: the fold's store", () => {
      const roots = [
        join(REPO_ROOT, "platform/app/src"),
        join(REPO_ROOT, "platform/app/ee"),
      ];
      const writes =
        /prisma\s*\.\s*ssoConnection\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)/;
      const offenders: string[] = [];
      for (const root of roots) {
        for (const entry of readdirSync(root, { recursive: true })) {
          const file = String(entry);
          if (!file.endsWith(".ts")) continue;
          if (file.includes("__tests__")) continue;
          // Prisma's own generated model module names every write method for
          // every table; it is the client, not a caller.
          if (file.startsWith("generated/")) continue;
          if (writes.test(readFileSync(join(root, file), "utf8"))) {
            offenders.push(file);
          }
        }
      }

      expect(offenders).toEqual([
        "server/app-layer/identity/repositories/sso-connection-projection.prisma.repository.ts",
      ]);
    });
  });
});
