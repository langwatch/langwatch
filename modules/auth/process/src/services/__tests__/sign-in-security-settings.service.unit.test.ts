/**
 * @vitest-environment node
 * The administrator's side of the two sign-in security rules, over the
 * module's own memory twins.
 * @see specs/identity/org-account-lockout.feature
 * @see specs/identity/org-session-lifetime.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { NO_FAILED_ATTEMPTS } from "@langwatch/auth-contract";
import { EnterprisePlanRequiredError } from "@langwatch/entitlement-contract";
import { UserNotInOrganizationError } from "@langwatch/organization-contract";
import { Temporal, type Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { BrowserSessionService } from "../browser-session.service.ts";
import { SignInSecuritySettingsService } from "../sign-in-security-settings.service.ts";
import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const NOW = Temporal.Instant.from("2026-09-01T12:00:00.000Z");
const now = (): Instant => NOW;
const minutesAgo = (minutes: number): Instant => NOW.subtract({ minutes });

const OFF = {
  lockoutAfterFailedAttempts: 0,
  lockoutMinutes: 30,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};

function harness({
  entitled = true,
  members = ["ana", "sam", "kim", "lee", "joe"],
}: { entitled?: boolean; members?: string[] } = {}) {
  const fixture = signInSecurityFixture({ now });
  const memory = MemoryAuthDatabase.create();
  const sessionRows = MemoryAuthSessionRepository.create({ memory });
  const sessions = BrowserSessionService.create({
    sessions: sessionRows,
    cache: null,
    identityEmails: void 0,
    users: createApiFixture<UserApi>({ findById: async () => null }),
    sessionBound: fixture.sessionBound,
    now,
  });
  const plan = {
    assertEntitled: vi.fn(async () => {
      if (!entitled)
        throw new EnterprisePlanRequiredError(
          "Sign-in security controls require an Enterprise plan",
        );
    }),
  };
  const released = vi.fn(async () => undefined);
  for (const userId of members) fixture.settings.join({ userId, organizationId: "acme" });

  return {
    fixture,
    memory,
    plan,
    released,
    service: SignInSecuritySettingsService.create({
      settings: fixture.settings,
      locks: fixture.locks,
      members: {
        findMemberUserIds: async () => members,
        isMember: async ({ userId }) => members.includes(userId),
      },
      plan,
      evidence: { released },
      sessions,
    }),
  };
}

describe("SignInSecuritySettingsService", () => {
  describe("when an organization that never set a rule is read", () => {
    it("answers both rules off", async () => {
      const { service } = harness();

      await expect(service.get({ organizationId: "acme" })).resolves.toEqual(OFF);
    });
  });

  describe("when a window whose maximum is shorter than its idle timeout is saved", () => {
    it("refuses before asking the plan or writing anything", async () => {
      const { service, plan } = harness();

      await expect(
        service.save({
          organizationId: "acme",
          ...OFF,
          sessionIdleTimeoutMinutes: 60,
          sessionMaxLifetimeMinutes: 30,
        }),
      ).rejects.toMatchObject({ code: "identity_session_max_lifetime_too_short" });
      expect(plan.assertEntitled).not.toHaveBeenCalled();
      await expect(service.get({ organizationId: "acme" })).resolves.toEqual(OFF);
    });
  });

  describe("given the organization is fully off and asks to turn a rule on", () => {
    it("refuses without writing when the plan does not carry it", async () => {
      const { service } = harness({ entitled: false });

      await expect(
        service.save({ organizationId: "acme", ...OFF, lockoutAfterFailedAttempts: 5 }),
      ).rejects.toMatchObject({ code: "enterprise_plan_required" });
      await expect(service.get({ organizationId: "acme" })).resolves.toEqual(OFF);
    });

    /** @scenario "Saving a window ends the sessions already past it" */
    it("writes, then ends exactly the member sessions already past the new window", async () => {
      const { service, memory } = harness();
      for (const userId of ["sam", "kim", "lee"]) {
        memory.sessions.set(`idle-${userId}`, {
          id: `idle-${userId}`,
          userId,
          sessionToken: `token-${userId}`,
          impersonating: null,
          createdAt: minutesAgo(180),
          updatedAt: minutesAgo(120),
          lastSeenAt: minutesAgo(120),
        });
      }
      memory.sessions.set("working-joe", {
        id: "working-joe",
        userId: "joe",
        sessionToken: "token-joe",
        impersonating: null,
        createdAt: minutesAgo(180),
        updatedAt: minutesAgo(5),
        lastSeenAt: minutesAgo(5),
      });

      const result = await service.save({
        organizationId: "acme",
        ...OFF,
        sessionIdleTimeoutMinutes: 60,
      });

      expect(result).toEqual({ ok: true, sweptSessions: 3 });
      expect([...memory.sessions.keys()]).toEqual(["working-joe"]);
    });
  });

  describe("given a rule is already active", () => {
    it("adjusts the numbers and turns everything off without asking the plan again", async () => {
      const { service, plan } = harness({ entitled: false });
      const active = { organizationId: "acme", ...OFF, lockoutAfterFailedAttempts: 5 };
      plan.assertEntitled.mockResolvedValueOnce(undefined);
      await service.save(active);
      plan.assertEntitled.mockClear();

      await service.save({ ...active, lockoutAfterFailedAttempts: 3 });
      await service.save({ organizationId: "acme", ...OFF });

      expect(plan.assertEntitled).not.toHaveBeenCalled();
      await expect(service.get({ organizationId: "acme" })).resolves.toEqual(OFF);
    });
  });

  describe("given a member held after a fifth consecutive lock-out", () => {
    /** @scenario "An administrator can release a held account" */
    it("releases the account and records the release with the administrator's id", async () => {
      const { service, fixture, released } = harness();
      await fixture.locks.save({
        identifierHash: "keyed:sam@acme.com",
        state: { ...NO_FAILED_ATTEMPTS, consecutiveLockouts: 5, heldForReview: true },
        userId: "sam",
      });

      await expect(
        service.release({ organizationId: "acme", userId: "sam", actorUserId: "ana" }),
      ).resolves.toEqual({ released: true });
      expect(released).toHaveBeenCalledWith({
        organizationId: "acme",
        userId: "sam",
        actorUserId: "ana",
      });
      await expect(
        fixture.locks.findState({ identifierHash: "keyed:sam@acme.com" }),
      ).resolves.toEqual(NO_FAILED_ATTEMPTS);
    });

    it("reports no release and writes nothing to the record when nobody was held", async () => {
      const { service, released } = harness();

      await expect(
        service.release({ organizationId: "acme", userId: "sam", actorUserId: "ana" }),
      ).resolves.toEqual({ released: false });
      expect(released).not.toHaveBeenCalled();
    });

    it("refuses somebody outside the organization before touching the lock-out", async () => {
      const { service, fixture } = harness({ members: ["ana"] });
      await fixture.locks.save({
        identifierHash: "keyed:eve@other.com",
        state: { ...NO_FAILED_ATTEMPTS, heldForReview: true },
        userId: "eve",
      });

      await expect(
        service.release({ organizationId: "acme", userId: "eve", actorUserId: "ana" }),
      ).rejects.toBeInstanceOf(UserNotInOrganizationError);
      await expect(
        fixture.locks.findState({ identifierHash: "keyed:eve@other.com" }),
      ).resolves.toMatchObject({ heldForReview: true });
    });
  });
});
