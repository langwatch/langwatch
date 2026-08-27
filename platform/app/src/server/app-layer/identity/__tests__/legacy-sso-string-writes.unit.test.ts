/** @vitest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { explainHandledError } from "~/features/errors/logic/presentation";
import {
  assertLegacySsoStringWriteAllowed,
  legacySsoStringColumnsIn,
} from "../legacy-sso-string-writes";

/**
 * When a staff member may still set `Organization.ssoDomain` / `ssoProvider`.
 *
 * The rule used to be an environment variable with three modes, staged so a
 * fleet-wide flip could be rolled back in a hurry. There is no flip: routing
 * asks the connection projection first and falls back to the columns per
 * organization, so the answer differs per organization and a fleet-wide
 * switch could only ever be wrong for somebody.
 *
 * So the rule asks the data. An edit is refused exactly when it would change
 * nothing a person would experience — which is the case that matters, because
 * that is a staff member believing they fixed something.
 */

const REPO_ROOT = join(import.meta.dirname, "../../../../../../..");

const holdsConnection = vi.fn().mockResolvedValue(true);
const holdsNone = vi.fn().mockResolvedValue(false);

describe("the legacy sso string columns", () => {
  describe("given an organization that never registered a connection", () => {
    /** @scenario "After the flip, the strings stop being written" */
    /** @scenario "Which routing decides is asked per organization, never set fleet-wide" */
    it("keeps accepting edits, because the strings still decide its sign-in", async () => {
      await expect(
        assertLegacySsoStringWriteAllowed({
          organizationId: "org_acme",
          data: { ssoDomain: "acme.com", ssoProvider: "okta" },
          hasConnection: holdsNone,
        }),
      ).resolves.toBeUndefined();
    });

    it("does not ask about a create, which names no organization yet", async () => {
      const asked = vi.fn().mockResolvedValue(true);
      await expect(
        assertLegacySsoStringWriteAllowed({
          organizationId: null,
          data: { ssoDomain: "acme.com" },
          hasConnection: asked,
        }),
      ).resolves.toBeUndefined();
      expect(asked).not.toHaveBeenCalled();
    });
  });

  describe("given an organization whose connection decides its sign-in", () => {
    /** @scenario "After the flip, the strings stop being written" */
    /** @scenario "Which routing decides is asked per organization, never set fleet-wide" */
    it("refuses a string edit and names the columns that are now derived", async () => {
      await expect(
        assertLegacySsoStringWriteAllowed({
          organizationId: "org_acme",
          data: { name: "Acme", ssoDomain: "acme.com" },
          hasConnection: holdsConnection,
        }),
      ).rejects.toThrowError(
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
    it("points the reader at the organization's connection instead", async () => {
      const refusal = await assertLegacySsoStringWriteAllowed({
        organizationId: "org_acme",
        data: { ssoProvider: "okta" },
        hasConnection: holdsConnection,
      }).then(
        () => null,
        (error: { code: string }) => error,
      );
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
    it("leaves every other organization edit alone, without asking", async () => {
      const asked = vi.fn().mockResolvedValue(true);
      await expect(
        assertLegacySsoStringWriteAllowed({
          organizationId: "org_acme",
          data: { name: "Acme", presenceEnabled: false },
          hasConnection: asked,
        }),
      ).resolves.toBeUndefined();
      await expect(
        assertLegacySsoStringWriteAllowed({
          organizationId: "org_acme",
          data: undefined,
          hasConnection: asked,
        }),
      ).resolves.toBeUndefined();
      // A payload naming none of the columns is not a question about
      // connections, so it costs no query.
      expect(asked).not.toHaveBeenCalled();
    });
  });

  describe("given a connection changes", () => {
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
          // Scaffolding shared between suites. It lives outside `__tests__`
          // so several of them can import it, but it is no more a production
          // writer than they are -- and prose that spells the call it is
          // explaining it does NOT make reads as a caller to this scanner.
          if (file.startsWith("test-utils/")) continue;
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
