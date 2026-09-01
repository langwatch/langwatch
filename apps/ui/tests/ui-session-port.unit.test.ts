/**
 * The port itself, over one render's worth of answers.
 *
 * Two properties are load-bearing beyond "it returns the right value". It
 * FAILS CLOSED on everything it has no answer for, so a screen never renders
 * open and then closes. And it answers from what was resolved for the scope
 * rather than deriving it per question: a page asking about a dozen
 * permissions on every render is ordinary, and paying for it a dozen times a
 * render is not.
 */

import { describe, expect, it } from "vitest";
import { BrowserUiSession, UiFeatureFlagRequests } from "../src/behavior/ui-session";

/** A granted set that says whether the port consulted it, or a copy of it. */
class CountingSet extends Set<string> {
  reads = 0;

  override has(value: string): boolean {
    this.reads += 1;
    return super.has(value);
  }
}

const SOMEWHERE = { organizationId: "org-acme", projectId: "proj-app" };

function sessionWith({
  permissions,
  flags = new Map<string, boolean>(),
  askFlag = () => void 0,
}: {
  permissions: ReadonlySet<string> | undefined;
  flags?: ReadonlyMap<string, boolean>;
  askFlag?: (flag: string) => void;
}) {
  return BrowserUiSession.create({
    actor: { id: "user-jane", name: "Jane", email: null, image: null },
    scope: SOMEWHERE,
    permissions,
    settled: permissions !== void 0,
    flags,
    askFlag,
  });
}

describe("given the session port over a resolved scope", () => {
  describe("when a screen asks who is here and where", () => {
    it("answers with the reader and the scope it was built for", () => {
      const session = sessionWith({ permissions: new Set() });

      expect(session.currentUser()?.id).toBe("user-jane");
      expect(session.activeScope()).toEqual(SOMEWHERE);
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

describe("given a screen that asks about a feature flag", () => {
  describe("when the flag has no answer yet", () => {
    it("answers no and registers the flag to be read", () => {
      const asked: string[] = [];
      const session = sessionWith({
        permissions: new Set(),
        askFlag: (flag) => asked.push(flag),
      });

      expect(session.isFeatureEnabled("release_new_thing")).toBe(false);
      expect(asked).toEqual(["release_new_thing"]);
    });
  });

  describe("when the answer has arrived", () => {
    it("answers with it, and asks for nothing further", () => {
      const asked: string[] = [];
      const session = sessionWith({
        permissions: new Set(),
        flags: new Map([
          ["release_new_thing", true],
          ["release_other_thing", false],
        ]),
        askFlag: (flag) => asked.push(flag),
      });

      expect(session.isFeatureEnabled("release_new_thing")).toBe(true);
      expect(session.isFeatureEnabled("release_other_thing")).toBe(false);
      expect(asked).toEqual([]);
    });
  });
});

describe("given the register of flags screens have asked about", () => {
  describe("when the same flag is asked for repeatedly", () => {
    it("records it once, in ask order", () => {
      const requests = new UiFeatureFlagRequests();

      requests.ask("second");
      requests.ask("first");
      requests.ask("second");

      expect(requests.requested()).toEqual(["second", "first"]);
    });

    it("tells its readers once per new flag, and never for a repeat", async () => {
      const requests = new UiFeatureFlagRequests();
      let told = 0;
      const stop = requests.subscribe(() => {
        told += 1;
      });

      requests.ask("first");
      requests.ask("first");
      await Promise.resolve();

      expect(told).toBe(1);
      stop();
    });
  });
});
