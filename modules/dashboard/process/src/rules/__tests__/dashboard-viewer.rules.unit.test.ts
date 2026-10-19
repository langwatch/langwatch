/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { viewerOfActor } from "../dashboard-viewer.rules.ts";

describe("viewerOfActor()", () => {
  describe("given the actor a personal key or an access token resolves to", () => {
    /** @scenario "AC196 Scope: a key that names a person reads and writes as that person over REST" */
    it("names that person as the viewer", () => {
      expect(viewerOfActor({ actor: { type: "user", id: "user-1" } })).toEqual({
        viewer: { userId: "user-1" },
      });
    });
  });

  describe("given a key that names no person", () => {
    /** @scenario "AC197 Scope: a key that names no person stands where a project credential does" */
    it.each([
      { key: "a legacy project key or a service key", actor: null },
      { key: "an unattended run's key", actor: { type: "system", name: "unattendedRun" } as const },
      { key: "a key acting as itself", actor: { type: "api_key", id: "key-1" } as const },
    ])("names no viewer for $key", ({ actor }) => {
      expect(viewerOfActor({ actor })).toEqual({});
    });
  });
});
