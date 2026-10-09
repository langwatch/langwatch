/**
 * The port itself, over one render's worth of answers.
 */

import { describe, expect, it } from "vitest";

import { BrowserUiSession } from "../ui-session";

/** A granted set that says whether the port consulted it, or a copy of it. */
class CountingSet extends Set<string> {
  reads = 0;

  override has(value: string): boolean {
    this.reads += 1;
    return super.has(value);
  }
}

function sessionWith({ permissions }: { permissions: ReadonlySet<string> | undefined }) {
  return BrowserUiSession.create({
    actor: { id: "user-jane", name: "Jane", email: null, image: null },
    permissions,
    settled: permissions !== void 0,
  });
}

describe("given a screen changed who the reader is", () => {
  describe("when it asks the session to be read again", () => {
    it("re-reads through the shell's own session read", async () => {
      let reads = 0;
      const session = BrowserUiSession.create({
        actor: null,
        permissions: void 0,
        settled: false,
        refresh: async () => {
          reads += 1;
        },
      });

      await session.refresh();

      expect(reads).toBe(1);
    });
  });
});

describe("given the session port over a resolved scope", () => {
  describe("when a screen asks who is here", () => {
    it("answers with the reader it was built for", () => {
      const session = sessionWith({ permissions: new Set() });

      expect(session.currentUser()?.id).toBe("user-jane");
    });
  });

  describe("when the server has not answered for this scope yet", () => {
    it("refuses every permission rather than reporting an empty set as a decision", () => {
      const session = sessionWith({ permissions: void 0 });

      expect(session.hasPermission("datasets:view")).toBe(false);
      expect(session.hasPermission("organization:manage")).toBe(false);
    });
  });

  describe("when the server has answered", () => {
    it("applies the engine's own hierarchy rule to the granted set", () => {
      const session = sessionWith({ permissions: new Set(["datasets:manage"]) });

      expect(session.hasPermission("datasets:view")).toBe(true);
      expect(session.hasPermission("datasets:delete")).toBe(true);
      expect(session.hasPermission("datasets:manage")).toBe(true);
    });

    it("never reads a grant backwards, so view alone never implies manage", () => {
      const session = sessionWith({ permissions: new Set(["datasets:view"]) });

      expect(session.hasPermission("datasets:view")).toBe(true);
      expect(session.hasPermission("datasets:manage")).toBe(false);
      expect(session.hasPermission("prompts:view")).toBe(false);
    });
  });

  describe("when a screen asks about many permissions", () => {
    it("consults the set resolved for the scope rather than deriving one per question", () => {
      const granted = new CountingSet(["datasets:manage"]);
      const session = sessionWith({ permissions: granted });

      session.hasPermission("datasets:view");
      session.hasPermission("prompts:view");
      session.hasPermission("analytics:view");

      // Every question went to the one set the scope resolved. A port that
      // rebuilt its own would answer the same and consult this one never.
      expect(granted.reads).toBeGreaterThanOrEqual(3);
    });
  });
});
