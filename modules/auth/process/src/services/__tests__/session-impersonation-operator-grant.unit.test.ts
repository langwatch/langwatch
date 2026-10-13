/**
 * @vitest-environment node
 * A live impersonation is honoured only while the operator still holds the platform grant.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import type { VerifiedBrowserSession } from "@langwatch/auth-contract";
import { Temporal, toDate, type Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { TestUserApi } from "../../app/__tests__/support/test-user-api.ts";
import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { BrowserSessionService } from "../browser-session.service.ts";
import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const NOW = Temporal.Instant.from("2026-10-06T09:00:00.000Z");
const now = (): Instant => NOW;

async function impersonating({ operatorHoldsGrant }: { operatorHoldsGrant: boolean }) {
  const memory = MemoryAuthDatabase.create();
  const can = vi.fn(async () => operatorHoldsGrant);
  const users = new TestUserApi({
    findById: async ({ id }): Promise<UserProfile> => ({
      id,
      name: id,
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
    operators: { can },
    now,
  });
  memory.db.Session.push({
    id: "session-operator",
    userId: "operator",
    sessionToken: "token-operator",
    amr: ["pwd", "otp"],
    createdAt: toDate(NOW),
    updatedAt: toDate(NOW),
    lastSeenAt: toDate(NOW),
  });
  await service.startImpersonation({
    sessionId: "session-operator",
    actorUserId: "operator",
    subjectUserId: "sam",
    reason: "Debugging trace 42",
    expiresAt: NOW.add({ hours: 1 }),
  });
  const verified: VerifiedBrowserSession = {
    session: { id: "session-operator", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
    user: { id: "operator", name: "operator", email: null, image: null },
  };
  return { resolved: await service.resolveBrowserSession({ verified }), can };
}

describe("a live impersonation read after the operator's platform grant changed", () => {
  it("answers the operator's own session once the grant is gone", async () => {
    const { resolved, can } = await impersonating({ operatorHoldsGrant: false });

    expect(can).toHaveBeenCalledWith({
      principal: { type: "user", id: "operator" },
      permission: "ops:manage",
      scope: { type: "platform" },
    });
    expect(resolved).toMatchObject({ kind: "signed_in", session: { user: { id: "operator" } } });
    expect(resolved).not.toMatchObject({ session: { user: { impersonator: {} } } });
  });

  it("acts as the subject while the grant holds", async () => {
    const { resolved } = await impersonating({ operatorHoldsGrant: true });

    expect(resolved).toMatchObject({
      kind: "signed_in",
      session: { user: { id: "sam", impersonator: { id: "operator" } } },
    });
  });
});
