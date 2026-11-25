import { describe, expect, it } from "vitest";

import { langyRecoveryPolicy } from "../langy-recovery-policy.ts";

describe("langyRecoveryPolicy", () => {
  describe("when the turn was refused because the project is an aggregate", () => {
    it("never retries, the same turn is refused the same way", () => {
      const policy = langyRecoveryPolicy("aggregate_project_is_read_only");

      expect(policy.disposition).toBe("terminal");
      expect(policy.retry).toBe(false);
    });
  });
});
