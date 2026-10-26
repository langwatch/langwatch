/**
 * @vitest-environment node
 * Every way a browser session ends revokes the docs session keys it minted, first (ADR-185).
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import type { RevokeDocsSessionKeysInput } from "@langwatch/api-key-contract";
import { Temporal, toDate, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { TestUserApi } from "../../app/__tests__/support/test-user-api.ts";
import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { BrowserSessionService } from "../browser-session.service.ts";
import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const NOW = Temporal.Instant.from("2026-10-26T09:00:00.000Z");

function world() {
  const now = (): Instant => NOW;
  const memory = MemoryAuthDatabase.create();
  const revoked: RevokeDocsSessionKeysInput[] = [];
  const sessionsAtRevoke: string[][] = [];
  for (const id of ["session-1", "session-2", "session-3"]) {
    memory.db.Session.push({
      id,
      userId: "sam",
      sessionToken: `token-${id}`,
      createdAt: toDate(NOW),
      updatedAt: toDate(NOW),
      lastSeenAt: toDate(NOW),
      expires: new Date("2030-01-01T00:00:00.000Z"),
    });
  }
  const service = BrowserSessionService.create({
    docsKeys: {
      revokeDocsSessionKeys: async (input) => {
        revoked.push(input);
        sessionsAtRevoke.push(memory.db.Session.map((session) => session.id));
        return { revoked: true as const };
      },
    },
    sessions: MemoryAuthSessionRepository.create({ memory }),
    cache: null,
    identityEmails: void 0,
    users: new TestUserApi({}),
    sessionBound: signInSecurityFixture({ now }).sessionBound,
    now,
  });

  return { service, revoked, sessionsAtRevoke };
}

describe("given docs session keys minted by a browser session", () => {
  /** @scenario "Signing out of the app revokes every docs session key the session minted" */
  it("revokes that session's docs keys on sign-out, before the session row goes", async () => {
    const { service, revoked, sessionsAtRevoke } = world();

    await service.revokeBrowserSession({ sessionId: "session-1" });

    expect(revoked).toEqual([{ userId: "sam", browserSessionIds: ["session-1"] }]);
    expect(sessionsAtRevoke[0]).toContain("session-1");
  });

  /** @scenario "Signing out of the app revokes every docs session key the session minted" */
  it("revokes only the ended sessions' keys when the member ends other sessions", async () => {
    const others = world();
    await others.service.revokeOtherBrowserSessions({ userId: "sam", keepSessionId: "session-1" });
    const one = world();
    await one.service.endBrowserSession({ userId: "sam", sessionId: "session-2" });

    const ended = [...others.revoked, ...one.revoked].map((input) =>
      "browserSessionIds" in input ? [...input.browserSessionIds].toSorted() : [],
    );
    expect(ended).toEqual([["session-2", "session-3"], ["session-2"]]);
  });

  it("revokes every session's docs keys when all sessions are revoked", async () => {
    const { service, revoked } = world();

    await service.revokeAllBrowserSessions({ userId: "sam" });

    expect(revoked).toHaveLength(1);
    expect(
      "browserSessionIds" in revoked[0]! ? [...revoked[0].browserSessionIds].toSorted() : [],
    ).toEqual(["session-1", "session-2", "session-3"]);
  });
});
