/**
 * @vitest-environment node
 * What a signed-in request costs the database, over the module's own memory twins.
 * @see specs/identity/auth-read-caching.feature
 */
import { NO_LOCKOUT, type VerifiedBrowserSession } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { TestUserApi } from "../../app/__tests__/support/test-user-api.ts";
import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { SESSION_PERSON_TTL_MS, BrowserSessionService } from "../browser-session.service.ts";
import { SESSION_RULES_TTL_MS } from "../session-bound.service.ts";
import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const SIGNED_IN_AT = Temporal.Instant.from("2026-09-30T09:00:00.000Z");

function harness() {
  let clock = SIGNED_IN_AT;
  const now = (): Instant => clock;
  const fixture = signInSecurityFixture({ now });
  const memory = MemoryAuthDatabase.create();
  const rows = MemoryAuthSessionRepository.create({ memory });
  const users = new TestUserApi({
    findById: async ({ id }): Promise<UserProfile> => ({
      id,
      name: null,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      pendingSsoSetup: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastLoginAt: null,
      deactivatedAt: null,
    }),
  });
  const reads = {
    row: vi.spyOn(rows, "findById"),
    person: vi.spyOn(users, "findById"),
    rules: vi.spyOn(fixture.settings, "findConfigured"),
  };
  const service = BrowserSessionService.create({
    sessions: rows,
    cache: null,
    identityEmails: void 0,
    users,
    sessionBound: fixture.sessionBound,
    now,
  });
  const signIn = (userId: string): VerifiedBrowserSession => {
    memory.sessions.set(`session-${userId}`, {
      id: `session-${userId}`,
      userId,
      sessionToken: `token-${userId}`,
      impersonating: null,
      createdAt: clock,
      updatedAt: clock,
      lastSeenAt: clock,
    });
    return {
      session: { id: `session-${userId}`, expiresAt: new Date("2030-01-01T00:00:00.000Z") },
      user: { id: userId, name: null, email: null, image: null },
    };
  };
  const secondsPass = (seconds: number) => {
    clock = clock.add({ seconds });
  };

  return { service, fixture, memory, reads, signIn, secondsPass };
}

describe("reading a browser session", () => {
  describe("when one person makes ten requests within the window", () => {
    /** @scenario "Repeated reads of one session ask for the person and the rules once" */
    it("reads the session row every time and the person and rules once", async () => {
      const { service, reads, signIn, secondsPass } = harness();
      const verified = signIn("sam");

      for (let request = 0; request < 10; request++) {
        await service.resolveBrowserSession({ verified });
        secondsPass(2);
      }

      expect(reads.row).toHaveBeenCalledTimes(10);
      expect(reads.person).toHaveBeenCalledTimes(1);
      expect(reads.rules).toHaveBeenCalledTimes(1);
    });

    it("reads the person and rules again once the window has passed", async () => {
      const { service, reads, signIn, secondsPass } = harness();
      const verified = signIn("sam");

      await service.resolveBrowserSession({ verified });
      secondsPass(Math.max(SESSION_PERSON_TTL_MS, SESSION_RULES_TTL_MS) / 1000);
      await service.resolveBrowserSession({ verified });

      expect(reads.person).toHaveBeenCalledTimes(2);
      expect(reads.rules).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the session row is deleted while the person is remembered", () => {
    /** @scenario "An ended session is refused on the next request, whatever is remembered" */
    it("resolves nobody on the very next request", async () => {
      const { service, memory, signIn } = harness();
      const verified = signIn("sam");
      await service.resolveBrowserSession({ verified });

      memory.sessions.delete("session-sam");

      await expect(service.resolveBrowserSession({ verified })).resolves.toEqual({
        kind: "anonymous",
      });
    });
  });

  describe("when an administrator saves a window after the rules were remembered empty", () => {
    /** @scenario "A saved session window sweeps with fresh rules" */
    it("sweeps with the saved rule rather than the remembered one", async () => {
      const { service, fixture, memory, signIn } = harness();
      await fixture.organization({
        id: "acme",
        lockout: NO_LOCKOUT,
        sessionBound: { idleTimeoutMinutes: 0, maxLifetimeMinutes: 0 },
        members: ["sam"],
      });
      await service.resolveBrowserSession({ verified: signIn("sam") });
      const twoHoursAgo = SIGNED_IN_AT.subtract({ hours: 2 });
      memory.sessions.set("session-sam", {
        ...memory.sessions.get("session-sam")!,
        createdAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
        lastSeenAt: twoHoursAgo,
      });

      await fixture.settings.save({
        organizationId: "acme",
        rule: {
          lockout: NO_LOCKOUT,
          sessionBound: { idleTimeoutMinutes: 60, maxLifetimeMinutes: 0 },
        },
      });

      await expect(service.endSessionsPastWindow({ userIds: ["sam"] })).resolves.toBe(1);
      expect(memory.sessions.has("session-sam")).toBe(false);
    });
  });

  describe("when two people are signed in", () => {
    /** @scenario "One person's remembered details never answer for another" */
    it("answers each with their own address", async () => {
      const { service, signIn } = harness();
      const sam = await service.resolveBrowserSession({ verified: signIn("sam") });
      const kim = await service.resolveBrowserSession({ verified: signIn("kim") });

      expect(sam).toMatchObject({ session: { user: { id: "sam", email: "sam@example.com" } } });
      expect(kim).toMatchObject({ session: { user: { id: "kim", email: "kim@example.com" } } });
    });
  });
});
