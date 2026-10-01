/** @vitest-environment node */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { PriorSessionService } from "../prior-session.service.ts";

const NOW = Temporal.Instant.from("2026-09-25T12:00:00Z");
const EARLIER = Temporal.Instant.from("2026-09-01T00:00:00Z");
const LATER = Temporal.Instant.from("2026-10-01T00:00:00Z");

function priorSessions({
  expires,
  emails = { "user-1": "ana@acme.com" },
}: {
  expires?: Instant;
  emails?: Record<string, string | null>;
} = {}) {
  const memory = MemoryAuthDatabase.create();
  if (expires) {
    memory.sessions.set("session-1", {
      id: "session-1",
      userId: "user-1",
      sessionToken: "tok",
      impersonating: null,
      expires,
    });
  }

  return PriorSessionService.create({
    sessions: MemoryAuthSessionRepository.create({ memory }),
    findEmail: async ({ userId }) => emails[userId] ?? null,
    now: () => NOW,
  });
}

const withCookie = (value: string) => new Headers({ cookie: `better-auth.session_token=${value}` });

describe("PriorSessionService", () => {
  describe("when the caller's cookie names a session that expired", () => {
    it("greets the address the session belonged to", async () => {
      await expect(
        priorSessions({ expires: EARLIER }).explain({ headers: withCookie("tok.signature") }),
      ).resolves.toEqual({ kind: "expired", email: "ana@acme.com" });
    });

    /** @scenario "An expired session whose account is gone names nobody" */
    it("greets nobody once the account has gone", async () => {
      await expect(
        priorSessions({ expires: EARLIER, emails: {} }).explain({ headers: withCookie("tok.sig") }),
      ).resolves.toEqual({ kind: "unknown" });
    });
  });

  describe("when the cookie names a session that is still live", () => {
    it("does not claim it expired", async () => {
      await expect(
        priorSessions({ expires: LATER }).explain({ headers: withCookie("tok.sig") }),
      ).resolves.toEqual({ kind: "unknown" });
    });
  });

  describe("when the cookie names no session, or there is no cookie", () => {
    /** @scenario "An unreadable token reveals neither who nor why" */
    it("answers a token that matches no session the same as no cookie at all", async () => {
      await expect(priorSessions().explain({ headers: withCookie("tok.sig") })).resolves.toEqual({
        kind: "unknown",
      });
    });

    /** @scenario "A request with no session cookie is treated as a stranger" */
    it("names nobody for a request carrying no session cookie", async () => {
      await expect(
        priorSessions({ expires: EARLIER }).explain({ headers: new Headers() }),
      ).resolves.toEqual({ kind: "unknown" });
    });
  });
});
