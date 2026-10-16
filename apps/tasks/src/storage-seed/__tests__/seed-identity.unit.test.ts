import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEED_EMAIL_DOMAIN,
  resolveSeedEmailDomain,
  seedEmailAddress,
} from "../seed-identity.ts";

describe("given the environment the seed resolved", () => {
  describe("when SEED_EMAIL_DOMAIN is unset", () => {
    /** @scenario "The seeded identity keeps one address everywhere" */
    it("seeds the stable global domain", () => {
      expect(resolveSeedEmailDomain({ environment: {} })).toBeUndefined();
      expect(seedEmailAddress({ localPart: "admin" })).toBe(`admin@${DEFAULT_SEED_EMAIL_DOMAIN}`);
    });

    /** @scenario "The seeded identity keeps one address everywhere" */
    it("treats an empty value the same as unset", () => {
      expect(resolveSeedEmailDomain({ environment: { SEED_EMAIL_DOMAIN: "" } })).toBeUndefined();
    });
  });

  describe("when SEED_EMAIL_DOMAIN is set", () => {
    /** @scenario "Per-stack seed addresses remain available on ask" */
    it("moves every seeded address's domain, leaving the local part unchanged", () => {
      const domainOverride = resolveSeedEmailDomain({
        environment: { SEED_EMAIL_DOMAIN: "worktree-a.langwatch.localhost" },
      });
      expect(domainOverride).toBe("worktree-a.langwatch.localhost");
      expect(seedEmailAddress({ localPart: "admin", domainOverride })).toBe(
        "admin@worktree-a.langwatch.localhost",
      );
    });
  });
});
