/**
 * @vitest-environment node
 * Impersonation rides the session's {actor, subject} claims (D06), written and read by auth alone.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import type { VerifiedBrowserSession } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { TestUserApi } from "../../app/__tests__/support/test-user-api.ts";
import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { PrismaAuthSessionRepository } from "../../repositories/prisma/prisma.auth-session.repository.ts";
import {
  liveImpersonation,
  type StoredImpersonationClaims,
} from "../../rules/impersonation-claims.rules.ts";
import { BrowserSessionService } from "../browser-session.service.ts";
import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const NOW = Temporal.Instant.from("2026-10-06T09:00:00.000Z");
const IN_AN_HOUR = NOW.add({ hours: 1 });
const now = (): Instant => NOW;

function harness() {
  const memory = MemoryAuthDatabase.create();
  const users = new TestUserApi({
    findById: async ({ id }): Promise<UserProfile> => ({
      id,
      name: id === "sam" ? "Sam" : "Operator",
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
    sessionBound: signInSecurityFixture({ now }).sessionBound,
    now,
  });
  memory.sessions.set("session-operator", {
    id: "session-operator",
    userId: "operator",
    sessionToken: "token-operator",
    impersonation: null,
    amr: ["pwd", "otp"],
    createdAt: NOW,
    updatedAt: NOW,
    lastSeenAt: NOW,
  });
  const verified: VerifiedBrowserSession = {
    session: { id: "session-operator", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
    user: { id: "operator", name: "Operator", email: null, image: null },
  };

  return { memory, service, verified };
}

const start = {
  sessionId: "session-operator",
  actorUserId: "operator",
  subjectUserId: "sam",
  reason: "Debugging trace 42",
  expiresAt: IN_AN_HOUR,
};

describe("BrowserSessionService impersonation", () => {
  describe("when an operator starts impersonating somebody", () => {
    /** @scenario "An impersonated session records both people" */
    it("records the operator as the actor and the person as the subject, keeping the operator's proof", async () => {
      const { memory, service, verified } = harness();

      await service.startImpersonation(start);

      const row = memory.sessions.get("session-operator");
      expect(row?.impersonation).toEqual({
        actorUserId: "operator",
        subjectUserId: "sam",
        reason: "Debugging trace 42",
        expiresAt: IN_AN_HOUR,
      });
      expect(row?.amr).toEqual(["pwd", "otp"]);
      await expect(service.getImpersonation({ sessionId: "session-operator" })).resolves.toEqual({
        kind: "impersonating",
        impersonation: {
          actorUserId: "operator",
          subjectUserId: "sam",
          reason: "Debugging trace 42",
          expiresAt: IN_AN_HOUR,
        },
      });
      await expect(service.resolveBrowserSession({ verified })).resolves.toMatchObject({
        kind: "signed_in",
        session: { user: { id: "sam", name: "Sam", impersonator: { id: "operator" } } },
      });
    });

    /** @scenario "An impersonated session records both people" */
    it("writes the claim columns and nothing to the legacy impersonation payload", async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const repository = PrismaAuthSessionRepository.create({
        prisma: { session: { updateMany } } as never,
      });

      await repository.writeImpersonation({
        sessionId: "session-operator",
        claims: { ...start, reason: start.reason },
      });

      const [[{ where, data }]] = updateMany.mock.calls as [[{ where: unknown; data: object }]];
      expect(where).toEqual({ id: "session-operator" });
      expect(data).toEqual({
        actorUserId: "operator",
        subjectUserId: "sam",
        impersonationReason: "Debugging trace 42",
        impersonationExpiresAt: new Date("2026-10-06T10:00:00.000Z"),
      });
      expect(data).not.toHaveProperty("impersonating");
    });
  });

  describe("when the operator stops", () => {
    it("returns the session to the operator without ending it, idempotently", async () => {
      const { memory, service, verified } = harness();
      await service.startImpersonation(start);

      await service.stopImpersonation({ sessionId: "session-operator" });
      await service.stopImpersonation({ sessionId: "session-operator" });

      expect(memory.sessions.get("session-operator")?.impersonation).toBeNull();
      await expect(service.resolveBrowserSession({ verified })).resolves.toMatchObject({
        kind: "signed_in",
        session: { user: { id: "operator" } },
      });
    });
  });

  describe("when a session's claims do not make a live impersonation", () => {
    const claims = (overrides: Partial<StoredImpersonationClaims>): StoredImpersonationClaims => ({
      actorUserId: "operator",
      subjectUserId: "sam",
      reason: "Debugging trace 42",
      expiresAt: IN_AN_HOUR,
      ...overrides,
    });

    it.each([
      ["half-written", claims({ subjectUserId: null })],
      ["lapsed", claims({ expiresAt: NOW })],
      ["self-naming", claims({ subjectUserId: "operator" })],
      ["written for another actor", claims({ actorUserId: "somebody-else" })],
    ])("reads a %s claim as the operator acting as themselves", (_label, stored) => {
      expect(liveImpersonation({ sessionUserId: "operator", claims: stored, now: NOW })).toEqual({
        kind: "none",
      });
    });

    it("reads a session that is gone as no impersonation", async () => {
      await expect(harness().service.getImpersonation({ sessionId: "gone" })).resolves.toEqual({
        kind: "none",
      });
    });
  });
});
