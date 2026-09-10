import { describe, expect, it } from "vitest";
import {
  type PriorSessionRow,
  PriorSessionService,
  sessionTokenFromCookieValue,
} from "../prior-session.service";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const YESTERDAY = new Date("2026-09-09T12:00:00.000Z");
const NEXT_MONTH = new Date("2026-10-10T12:00:00.000Z");

type SessionRow = {
  expires: Date;
  user: { email: string | null } | null;
};

/**
 * One row keyed by token, which is the only read the service makes. Answering
 * `null` for an unknown token is what the repository does for a token with no
 * row, and the service must treat it the same as a revoked one.
 *
 * Rows are still declared in Prisma's nested shape, because that is what the
 * repository reads; flattening them here is the repository's job and doing it
 * in the fixture is what keeps the two in step.
 */
function harness(rows: Record<string, SessionRow> = {}) {
  const asked: string[] = [];
  const repository = {
    findByToken: async ({
      token,
    }: {
      token: string;
    }): Promise<PriorSessionRow | null> => {
      asked.push(token);
      const row = rows[token];
      if (!row) return null;
      return { expires: row.expires, email: row.user?.email ?? null };
    },
  };
  const service = new PriorSessionService({ repository, now: () => NOW });
  return { service, asked };
}

describe("sessionTokenFromCookieValue", () => {
  describe("given better-auth's signed cookie shape", () => {
    it("keeps the token and drops the signature", () => {
      expect(sessionTokenFromCookieValue("tok_abc.sigXYZ")).toBe("tok_abc");
    });

    it("takes an unsigned value as the token itself", () => {
      expect(sessionTokenFromCookieValue("tok_abc")).toBe("tok_abc");
    });
  });

  describe("given nothing to read", () => {
    it("answers null for absent, empty, and signature-only values", () => {
      expect(sessionTokenFromCookieValue(null)).toBeNull();
      expect(sessionTokenFromCookieValue(undefined)).toBeNull();
      expect(sessionTokenFromCookieValue("")).toBeNull();
      // A leading dot names no token, so there is nothing to look up.
      expect(sessionTokenFromCookieValue(".sigOnly")).toBeNull();
    });
  });
});

describe("the prior-session explanation", () => {
  describe("when the cookie names an expired session", () => {
    it("names the address so the sign-in screen can carry it forward", async () => {
      const { service } = harness({
        tok_sam: { expires: YESTERDAY, user: { email: "sam@acme.com" } },
      });

      await expect(
        service.explain({ sessionCookie: "tok_sam.signature" }),
      ).resolves.toEqual({ kind: "expired", email: "sam@acme.com" });
    });
  });

  describe("when no session cookie arrived at all", () => {
    /** @scenario "A request with no session cookie is treated as a stranger" */
    it("names nobody, and does not go to the database to find that out", async () => {
      const { service, asked } = harness();

      await expect(service.explain({ sessionCookie: null })).resolves.toEqual({
        kind: "unknown",
      });
      expect(asked).toEqual([]);
    });
  });

  describe("when the cookie matches no session we issued", () => {
    /**
     * The forgery case, and the reason the answer carries no reason code. A
     * response that distinguished "that token could not be read" from "no
     * cookie" would tell somebody probing with a made-up cookie how close they
     * got. It is the same `unknown` a stranger gets.
     */
    /** @scenario "An unreadable token reveals neither who nor why" */
    it("answers exactly what a visitor with no cookie is told", async () => {
      const { service } = harness({
        tok_real: { expires: YESTERDAY, user: { email: "sam@acme.com" } },
      });

      const forged = await service.explain({
        sessionCookie: "tok_invented.whatever",
      });
      const stranger = await service.explain({ sessionCookie: null });

      expect(forged).toEqual({ kind: "unknown" });
      expect(forged).toEqual(stranger);
    });
  });

  describe("when the session was ended deliberately rather than left to expire", () => {
    /**
     * THE SECURITY PROPERTY. Revocation deletes the row, so a revoked session
     * reaches this read as a token with no row — the same shape as a forgery.
     * That is deliberate and must stay: ending every session is what somebody
     * does when they think a machine is not theirs, and printing the account's
     * address on that machine afterwards would undo it.
     */
    /** @scenario "A revoked session is given the cold screen and no address" */
    it("names nobody, because the row is gone", async () => {
      const { service } = harness({});

      await expect(
        service.explain({ sessionCookie: "tok_revoked.signature" }),
      ).resolves.toEqual({ kind: "unknown" });
    });
  });

  describe("when the session has not expired yet", () => {
    it("names nobody, because 'your session expired' would be false", async () => {
      // The gate rejected this request for some other reason — an impersonation
      // guard, a second factor, a cache miss mid-revocation. Whatever it was,
      // this screen must not invent expiry as the explanation.
      const { service } = harness({
        tok_live: { expires: NEXT_MONTH, user: { email: "sam@acme.com" } },
      });

      await expect(
        service.explain({ sessionCookie: "tok_live.signature" }),
      ).resolves.toEqual({ kind: "unknown" });
    });
  });

  describe("when the account went after the session did", () => {
    /** @scenario "An expired session whose account is gone names nobody" */
    it("names nobody, having nobody to name", async () => {
      const { service } = harness({
        tok_deleted: { expires: YESTERDAY, user: null },
        tok_blank: { expires: YESTERDAY, user: { email: null } },
      });

      await expect(
        service.explain({ sessionCookie: "tok_deleted.sig" }),
      ).resolves.toEqual({ kind: "unknown" });
      await expect(
        service.explain({ sessionCookie: "tok_blank.sig" }),
      ).resolves.toEqual({ kind: "unknown" });
    });
  });
});
