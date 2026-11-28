/**
 * @see modules/gateway/specs/gateway-governance-events.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { toPersonActorId } from "../gateway-governance-actor.rules.ts";

describe("toPersonActorId", () => {
  describe("when the actor is any of the system principals", () => {
    /** @scenario "A created key's fact names the person who made it and the person it acts for" */
    it("names no person for every one of them", () => {
      for (const actor of Object.values(SYSTEM_ACTORS)) {
        expect(toPersonActorId(actor), actor).toBeNull();
      }
    });
  });

  describe("when the actor is a project or API key's svc_ principal", () => {
    it("names no person", () => {
      expect(toPersonActorId("svc_project_1")).toBeNull();
    });
  });

  describe("when the actor is a person", () => {
    it("names that person", () => {
      expect(toPersonActorId("user_jane")).toBe("user_jane");
    });
  });
});
