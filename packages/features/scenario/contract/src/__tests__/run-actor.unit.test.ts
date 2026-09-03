/**
 * @vitest-environment node
 *
 * Which caller a REST run is recorded against.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */

import { describe, expect, it } from "vitest";
import { runActorFromRequest, withActor } from "../run-actor";

describe("the actor of a REST run", () => {
  describe("when the key belongs to a person", () => {
    /** @scenario "A user-bound key records the person it belongs to, through the surface it declared" */
    it("records that person, through the surface the request declared", () => {
      expect(
        runActorFromRequest({
          userId: "user_lena",
          surfaceHeader: "cli",
        }),
      ).toEqual({ id: "user_lena", label: "cli" });

      expect(runActorFromRequest({ userId: "user_lena", surfaceHeader: undefined })).toEqual({
        id: "user_lena",
        label: "api",
      });

      // Only "cli" is honored, so a caller cannot claim the in-app surface.
      expect(runActorFromRequest({ userId: "user_lena", surfaceHeader: "user" })).toEqual({
        id: "user_lena",
        label: "api",
      });
    });
  });

  describe("when the key belongs to no person", () => {
    /** @scenario "A user-bound key records the person it belongs to, through the surface it declared" */
    it("names no actor, whatever surface the request declares", () => {
      expect(runActorFromRequest({ userId: null, surfaceHeader: "cli" })).toBeUndefined();
      expect(runActorFromRequest({ userId: undefined, surfaceHeader: undefined })).toBeUndefined();
    });
  });
});

describe("what an actor writes into the run metadata", () => {
  it("writes the id and the surface together, or neither", () => {
    expect(withActor({ id: "user_lena", label: "user" })).toEqual({
      actorId: "user_lena",
      actorLabel: "user",
    });
    expect(withActor(undefined)).toEqual({});
  });
});
