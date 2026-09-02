/**
 * @vitest-environment node
 * @unit
 *
 * The no-Redis memo's own housekeeping. The Redis memo hands expiry to Redis;
 * this one has to do it itself, or a process that never restarts keeps one
 * entry per session it ever saw.
 *
 * @see specs/coding-agent/session-git-context.feature
 */
import { describe, expect, it } from "vitest";
import {
  InMemorySessionContextMemo,
  type SessionWorkingContext,
} from "../session-context-memo";

const DAY = 24 * 60 * 60 * 1000;

const context: SessionWorkingContext = {
  repositoryHost: "github.com",
  repositoryOwner: "acme",
  repositoryName: "widgets",
  branch: "feat/split",
};

describe("InMemorySessionContextMemo", () => {
  describe("given a context written to the memo", () => {
    describe("when it is read back inside its lifetime", () => {
      it("answers the declared context", async () => {
        const memo = new InMemorySessionContextMemo(() => 0);
        await memo.set({ tenantId: "p1", sessionId: "s1", context });

        expect(await memo.get({ tenantId: "p1", sessionId: "s1" })).toEqual(
          context,
        );
      });
    });

    describe("when its lifetime has passed", () => {
      /** @scenario "A memo entry is forgotten once its lifetime passes" */
      it("answers nothing for that session", async () => {
        let now = 0;
        const memo = new InMemorySessionContextMemo(() => now);
        await memo.set({ tenantId: "p1", sessionId: "s1", context });

        now = 181 * DAY;

        expect(await memo.get({ tenantId: "p1", sessionId: "s1" })).toBeNull();
      });
    });
  });

  describe("given more sessions than the memo holds", () => {
    /** @scenario "The no-Redis memo stops growing at its bound" */
    it("evicts the oldest and keeps the newest", async () => {
      const memo = new InMemorySessionContextMemo(() => 0);
      // One past the bound, so exactly the first write is evicted.
      for (let index = 0; index <= 10_000; index++) {
        await memo.set({
          tenantId: "p1",
          sessionId: `s${index}`,
          context,
        });
      }

      expect(await memo.get({ tenantId: "p1", sessionId: "s0" })).toBeNull();
      expect(await memo.get({ tenantId: "p1", sessionId: "s1" })).toEqual(
        context,
      );
      expect(await memo.get({ tenantId: "p1", sessionId: "s10000" })).toEqual(
        context,
      );
    });
  });

  describe("given two tenants that share a session id", () => {
    it("keeps their contexts apart", async () => {
      const memo = new InMemorySessionContextMemo(() => 0);
      await memo.set({ tenantId: "p1", sessionId: "shared", context });
      await memo.set({
        tenantId: "p2",
        sessionId: "shared",
        context: { ...context, branch: "feat/other" },
      });

      expect(
        (await memo.get({ tenantId: "p1", sessionId: "shared" }))?.branch,
      ).toBe("feat/split");
      expect(
        (await memo.get({ tenantId: "p2", sessionId: "shared" }))?.branch,
      ).toBe("feat/other");
    });
  });
});
