/**
 * @vitest-environment node
 *
 * Who a REST write to the workbench is attributed to: the label is what the
 * version history shows, so an agent's edit must not read as a person's.
 */

import { describe, expect, it } from "vitest";

import { workbenchActorFrom } from "../experiment-workbench-actor.rules.ts";

describe("attributing a workbench write to its credential", () => {
  describe("given a key minted for a person", () => {
    it("names the person and labels the write as an API write", () => {
      expect(workbenchActorFrom({ credential: { kind: "apiKey", userId: "user_1" } })).toEqual({
        userId: "user_1",
        label: "api",
      });
    });
  });

  describe("given a Langy session key", () => {
    it("labels the write as the agent's", () => {
      expect(
        workbenchActorFrom({
          credential: { kind: "apiKey", userId: "user_1", isLangySessionKey: true },
        }),
      ).toEqual({ userId: "user_1", label: "langy" });
    });
  });

  describe("given a service key that acts as nobody", () => {
    it("attributes the write to the surface rather than to a person", () => {
      expect(workbenchActorFrom({ credential: { kind: "apiKey", userId: null } })).toEqual({
        label: "api",
      });
    });
  });

  describe("given a legacy project key", () => {
    it("attributes the write to the surface", () => {
      expect(workbenchActorFrom({ credential: { kind: "legacyProjectKey" } })).toEqual({
        label: "api",
      });
    });
  });

  describe("when no credential was resolved at all", () => {
    it("still answers, rather than leaving the version unattributed", () => {
      expect(workbenchActorFrom({ credential: null })).toEqual({ label: "api" });
    });
  });
});
