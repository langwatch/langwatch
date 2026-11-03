import { SecretLimitReachedError, SecretNotFoundError } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { heldMessageOf, moveFailureOf } from "../agent-http-credentials-backfill.rules.ts";

describe("the agent credential step's failure reasons", () => {
  describe("when a refusal is permanent", () => {
    /** @scenario "An agent credential that can never be moved is left in place and the step completes" */
    it("names the reason by code, whether or not the error crossed a boundary", () => {
      expect(moveFailureOf(new SecretNotFoundError())).toEqual({
        kind: "kept",
        reason: "project_not_found",
      });
      expect(moveFailureOf({ code: "agent_not_found" })).toEqual({
        kind: "kept",
        reason: "agent_not_found",
      });
    });

    /** @scenario "A config the credential step produced that fails validation holds the step" */
    it("does not treat a schema error as permanent, since where it happened decides", () => {
      const schemaError = z.object({ url: z.string() }).safeParse({}).error;
      expect(moveFailureOf(schemaError)).toEqual({ kind: "held", reason: "ZodError" });
    });
  });

  describe("when an operator can fix the refusal", () => {
    /** @scenario "An agent credential an operator can unblock holds the step, naming the agent and why" */
    it("holds it under a stable reason code instead of keeping it for good", () => {
      expect(moveFailureOf(new SecretLimitReachedError())).toEqual({
        kind: "held",
        reason: "secret_limit_reached",
      });
      expect(moveFailureOf({ code: "authenticated_actor_required" })).toEqual({
        kind: "held",
        reason: "project_has_no_member",
      });
      expect(moveFailureOf({ code: "secret_already_exists" })).toEqual({
        kind: "held",
        reason: "secret_name_taken",
      });
      expect(moveFailureOf({ code: "secret_unreadable" })).toEqual({
        kind: "held",
        reason: "secret_unreadable",
      });
    });
  });

  describe("when a failure may clear on a retry", () => {
    /** @scenario "An agent credential that cannot be moved holds the agent credential step" */
    it("holds it, naming a database code or the error kind, never the message", () => {
      const dropped = Object.assign(new Error("tok_live_secret"), { code: "P1001" });
      expect(moveFailureOf(dropped)).toEqual({ kind: "held", reason: "P1001" });
      expect(moveFailureOf(new TypeError("tok_live_secret"))).toEqual({
        kind: "held",
        reason: "TypeError",
      });
    });

    /** @scenario "An agent credential that cannot be moved holds the agent credential step" */
    it("names the first held agents in the step's message and counts the rest", () => {
      const failed = Array.from({ length: 7 }, (_, index) => ({
        agentId: `agent_${index}`,
        projectId: "project_a",
        reason: "P1001",
      }));

      const message = heldMessageOf({ failed, held: failed.length });

      expect(message).toContain("7 HTTP agent credential(s) could not be stored");
      expect(message).toContain("agent agent_4 in project project_a: P1001");
      expect(message).not.toContain("agent_5");
      expect(message).toContain("and 2 more");
    });
  });
});
