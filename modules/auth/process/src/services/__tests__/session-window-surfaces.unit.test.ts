/**
 * @vitest-environment node
 * A session past its organization's window is refused by every reader of the session row.
 * @see specs/identity/org-session-lifetime.feature
 */
import { NO_LOCKOUT, type VerifiedBrowserSession } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { TestUserApi } from "../../app/__tests__/support/test-user-api.ts";
import { IdTokenIssuerRefusalChannel } from "../../channels/http/http.id-token-issuer-refusal.channel.ts";
import { MemoryCliDeviceSettlementChannel } from "../../channels/memory/memory.cli-device-settlement.channel.ts";
import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { MemoryCliDeviceSessionRepository } from "../../repositories/memory/memory.cli-device-session.repository.ts";
import { AuthDoorService } from "../auth-door.service.ts";
import { BrowserSessionVerificationService } from "../browser-session-verification.service.ts";
import { BrowserSessionService } from "../browser-session.service.ts";
import { CliDeviceSessionService } from "../cli-device-session.service.ts";
import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const SIGNED_IN_AT = Temporal.Instant.from("2026-09-30T09:00:00.000Z");
const COOKIE = "better-auth.session_token=token-sam.sig";

type World = Awaited<ReturnType<typeof worldWithAnIdleSessionPastItsWindow>>;

async function worldWithAnIdleSessionPastItsWindow({
  idleTimeoutMinutes = 60,
  idleForMinutes = 70,
}: { idleTimeoutMinutes?: number; idleForMinutes?: number } = {}) {
  let clock = SIGNED_IN_AT;
  const now = (): Instant => clock;
  const fixture = signInSecurityFixture({ now });
  const memory = MemoryAuthDatabase.create();
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
  const service = BrowserSessionService.create({
    sessions: MemoryAuthSessionRepository.create({ memory }),
    cache: null,
    identityEmails: void 0,
    users,
    sessionBound: fixture.sessionBound,
    now,
  });
  await fixture.organization({
    id: "acme",
    lockout: NO_LOCKOUT,
    sessionBound: { idleTimeoutMinutes, maxLifetimeMinutes: 0 },
    members: ["sam"],
  });
  memory.sessions.set("session-sam", {
    id: "session-sam",
    userId: "sam",
    sessionToken: "token-sam",
    impersonating: null,
    createdAt: clock,
    updatedAt: clock,
    lastSeenAt: clock,
  });
  const verified: VerifiedBrowserSession = {
    session: { id: "session-sam", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
    user: { id: "sam", name: null, email: null, image: null },
  };
  const sessions = {
    verifyBrowserSession: async () => ({ kind: "verified" as const, verified }),
    resolveBrowserSession: (input: { verified: VerifiedBrowserSession }) =>
      service.resolveBrowserSession(input),
  };
  clock = clock.add({ minutes: idleForMinutes });

  return { service, memory, sessions, verified };
}

describe("a session idle past its organization's window", () => {
  describe("when it is presented to the application, to the API and to a background request", () => {
    const surfaces = {
      application: async (world: World) => {
        const door = AuthDoorService.create({
          betterAuth: async () => ({ handler: async () => new Response(null, { status: 204 }) }),
          baseUrl: () => "https://app.test",
          ...world.sessions,
          revokeBrowserSession: async () => {},
          idTokenIssuerRefusals: IdTokenIssuerRefusalChannel.create(),
          connectionIssuers: { findIssuersForConnection: async () => [] },
          deriveQueryCacheKey: () => "key",
          now: () => SIGNED_IN_AT,
        });

        return door.getSessionByCookie({ cookie: COOKIE });
      },
      api: async (world: World) =>
        BrowserSessionVerificationService.create({ sessions: world.sessions as never }).verify(
          new Request("https://app.test/api/anything", { headers: { cookie: COOKIE } }),
        ),
      background: (world: World) =>
        world.service.resolveBrowserSession({ verified: world.verified }),
    };
    const refusals = {
      application: { document: null },
      api: { kind: "anonymous" },
      background: { kind: "anonymous" },
    };

    /** @scenario "A session past its window is refused on every surface" */
    it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])(
      "is refused by the %s surface, and the row is gone",
      async (surface) => {
        const world = await worldWithAnIdleSessionPastItsWindow();
        expect(world.memory.sessions.has("session-sam")).toBe(true);

        await expect(surfaces[surface](world)).resolves.toEqual(refusals[surface]);

        expect(world.memory.sessions.has("session-sam")).toBe(false);
      },
    );
  });
});

describe("an organization that ends browser sessions after an hour", () => {
  describe("when a member's CLI refreshes a day-old session", () => {
    /** @scenario "A browser window does not silently bound the CLI" */
    it("succeeds, while the same member's idle browser session is refused", async () => {
      const world = await worldWithAnIdleSessionPastItsWindow();
      let cliClock = SIGNED_IN_AT.epochMilliseconds;
      const cli = CliDeviceSessionService.create({
        store: MemoryCliDeviceSessionRepository.create({ now: () => cliClock }),
        settlements: MemoryCliDeviceSettlementChannel.create(),
      });
      const minted = await cli.mintSession({
        userId: "sam",
        organizationId: "acme",
        clientInfo: { hostname: "host", platform: "darwin", session_started_at: 100 },
      });
      cliClock += 24 * 60 * 60 * 1000;

      await expect(cli.getRefreshToken(minted.refreshToken)).resolves.toMatchObject({
        user_id: "sam",
      });
      await expect(
        world.service.resolveBrowserSession({ verified: world.verified }),
      ).resolves.toEqual({ kind: "anonymous" });
    });
  });
});

describe("an organization that caps CLI sessions but sets no browser window", () => {
  describe("when a member returns to their browser after ten days", () => {
    /** @scenario "A capped CLI does not bound the browser" */
    it("is still signed in, the cap being a CLI setting the browser session never reads", async () => {
      const world = await worldWithAnIdleSessionPastItsWindow({
        idleTimeoutMinutes: 0,
        idleForMinutes: 10 * 24 * 60,
      });

      await expect(
        world.service.resolveBrowserSession({ verified: world.verified }),
      ).resolves.toMatchObject({
        kind: "signed_in",
        session: { sessionId: "session-sam", user: { id: "sam" } },
      });
      expect(world.memory.sessions.has("session-sam")).toBe(true);
    });
  });
});

describe("sessions that record nothing about what they proved", () => {
  describe("when no organization requires two-step verification and each is used", () => {
    /** @scenario "Landing the change signs nobody out" */
    it("ends and refuses none of them, and answers them as it answers one that recorded a method", async () => {
      const world = await worldWithAnIdleSessionPastItsWindow({
        idleTimeoutMinutes: 0,
        idleForMinutes: 30 * 24 * 60,
      });
      const at = world.memory.sessions.get("session-sam")!.createdAt;
      const people = [
        { id: "sam", amr: undefined },
        { id: "ana", amr: [] },
        { id: "bo", amr: ["pwd"] },
      ] as const;
      for (const { id, amr } of people) {
        world.memory.sessions.set(`session-${id}`, {
          id: `session-${id}`,
          userId: id,
          sessionToken: `token-${id}`,
          impersonating: null,
          createdAt: at,
          updatedAt: at,
          lastSeenAt: at,
          ...(amr ? { amr } : {}),
        });
      }

      const resolved = await Promise.all(
        people.map(({ id }) =>
          world.service.resolveBrowserSession({
            verified: {
              session: { id: `session-${id}`, expiresAt: world.verified.session.expiresAt },
              user: { id, name: null, email: null, image: null },
            },
          }),
        ),
      );

      expect(resolved.map((answer) => answer.kind)).toEqual([
        "signed_in",
        "signed_in",
        "signed_in",
      ]);
      expect(people.map(({ id }) => world.memory.sessions.has(`session-${id}`))).toEqual([
        true,
        true,
        true,
      ]);
      const shapes = resolved.map((answer) =>
        answer.kind === "signed_in"
          ? { expires: answer.session.expires, ...answer.session.user, id: "", email: "" }
          : answer,
      );
      expect(shapes[0]).toEqual(shapes[2]);
      expect(shapes[1]).toEqual(shapes[2]);
    });
  });
});
