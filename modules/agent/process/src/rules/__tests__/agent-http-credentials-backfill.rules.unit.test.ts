import { SecretNotFoundError } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  failureReasonOf,
  heldMessageOf,
  keptReasonOf,
} from "../agent-http-credentials-backfill.rules.ts";

describe("the agent credential step's failure reasons", () => {
  describe("when a refusal is permanent", () => {
    /** @scenario "An agent credential that can never be moved is left in place and the step completes" */
    it("names the reason by code, whether or not the error crossed a boundary", () => {
      expect(keptReasonOf(new SecretNotFoundError())).toBe("project_not_found");
      expect(keptReasonOf({ code: "secret_limit_reached" })).toBe("secret_limit_reached");
      expect(keptReasonOf(z.object({ url: z.string() }).safeParse({}).error)).toBe(
        "config_invalid",
      );
    });
  });

  describe("when a failure may clear on a retry", () => {
    /** @scenario "An agent credential that cannot be moved holds the agent credential step" */
    it("holds it, naming a database code or the error kind, never the message", () => {
      const dropped = Object.assign(new Error("tok_live_secret"), { code: "P1001" });

      expect(keptReasonOf(dropped)).toBeUndefined();
      expect(failureReasonOf(dropped)).toBe("P1001");
      expect(failureReasonOf(new TypeError("tok_live_secret"))).toBe("TypeError");
    });

    /** @scenario "An agent credential that cannot be moved holds the agent credential step" */
    it("names the first held agents in the step's message and counts the rest", () => {
      const failed = Array.from({ length: 7 }, (_, index) => ({
        agentId: `agent_${index}`,
        projectId: "project_a",
        reason: "P1001",
      }));

      const message = heldMessageOf(failed);

      expect(message).toContain("7 HTTP agent credential(s) could not be stored");
      expect(message).toContain("agent agent_4 in project project_a: P1001");
      expect(message).not.toContain("agent_5");
      expect(message).toContain("and 2 more");
    });
  });
});
