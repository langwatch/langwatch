/**
 * @vitest-environment node
 * A saved name or photo reaches the session read, whatever Better Auth cached at sign-in.
 * @see specs/settings/profile.feature
 */
import type { VerifiedBrowserSession } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { TestUserApi } from "../../app/__tests__/support/test-user-api.ts";
import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { SESSION_PERSON_TTL_MS, BrowserSessionService } from "../browser-session.service.ts";
import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const SIGNED_IN_AT = Temporal.Instant.from("2026-09-30T09:00:00.000Z");

function harness() {
  let clock = SIGNED_IN_AT;
  const now = (): Instant => clock;
  const stored: { name: string | null; image: string | null } = {
    name: "Sam Saved",
    image: "https://avatars.example.com/new.png",
  };
  const memory = MemoryAuthDatabase.create();
  const users = new TestUserApi({
    findById: async ({ id }): Promise<UserProfile> => ({
      id,
      name: stored.name,
      email: `${id}@example.com`,
      emailVerified: true,
      image: stored.image,
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
    sessionBound: signInSecurityFixture({ now }).sessionBound,
    now,
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
    user: {
      id: "sam",
      name: "Sam Cached",
      email: null,
      image: "https://avatars.example.com/old.png",
    },
  };
  const read = async () => {
    const resolution = await service.resolveBrowserSession({ verified });
    return resolution.kind === "signed_in" ? resolution.session.user : null;
  };
  const windowPasses = () => {
    clock = clock.add({ milliseconds: SESSION_PERSON_TTL_MS });
  };

  return { stored, read, windowPasses };
}

describe("reading a browser session after the profile was saved", () => {
  describe("when Better Auth still caches the name and photo from sign-in", () => {
    it("answers the stored name and photo", async () => {
      const { read } = harness();

      await expect(read()).resolves.toMatchObject({
        name: "Sam Saved",
        image: "https://avatars.example.com/new.png",
      });
    });
  });

  describe("when the name changes and the photo is removed while signed in", () => {
    it("answers both once the remembered person has expired", async () => {
      const { stored, read, windowPasses } = harness();
      await read();

      stored.name = "Sam Renamed";
      stored.image = null;
      windowPasses();

      await expect(read()).resolves.toMatchObject({ name: "Sam Renamed", image: null });
    });
  });
});
