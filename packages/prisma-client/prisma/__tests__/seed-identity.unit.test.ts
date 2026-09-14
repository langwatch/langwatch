import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED_EMAIL_DOMAIN,
  buildAdminUserUpsertArgs,
  resolveSeedEmailDomain,
  seedEmailAddress,
} from "../seed-identity.ts";

describe("given the environment the seed resolved", () => {
  describe("when SEED_EMAIL_DOMAIN is unset", () => {
    /** @scenario "The seeded identity keeps one address everywhere" */
    it("seeds the stable global domain", () => {
      expect(resolveSeedEmailDomain({ environment: {} })).toBeUndefined();
      expect(seedEmailAddress({ localPart: "admin" })).toBe(
        `admin@${DEFAULT_SEED_EMAIL_DOMAIN}`,
      );
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

describe("given the admin user upsert the seed runs", () => {
  const ADMIN_USER_ID = "local-dev-admin-user";

  describe("when the account was seeded under the retired default address", () => {
    /** @scenario "A database seeded before the address rename reseeds onto the new one" */
    it("keys the lookup on the fixed user id, never on email, and rewrites the address in place", () => {
      const args = buildAdminUserUpsertArgs({
        adminUserId: ADMIN_USER_ID,
        email: "admin@mail.langwatch.localhost",
        name: "Haven Local Admin",
      });

      // The lookup is by id only — whatever address the row already carries
      // (including admin@haven.localhost, the retired default), this upsert
      // finds THAT SAME row rather than ever matching (or missing) by email.
      expect(args.where).toEqual({ id: ADMIN_USER_ID });
      // The update leg always carries the resolved address, so a reseed
      // moves an existing account onto it instead of leaving the old one
      // stored — the fix for the rename.
      expect(args.update).toEqual({ email: "admin@mail.langwatch.localhost" });
      // The create leg is only reached on a genuinely fresh database.
      expect(args.create).toMatchObject({
        id: ADMIN_USER_ID,
        email: "admin@mail.langwatch.localhost",
      });
    });
  });

  describe("when the account is reseeded unchanged", () => {
    /** @scenario "Reseeding keeps the seeded addresses stable" */
    it("writes the identical address again, so re-running seeds no duplicate", () => {
      const first = buildAdminUserUpsertArgs({
        adminUserId: ADMIN_USER_ID,
        email: "admin@mail.langwatch.localhost",
        name: "Haven Local Admin",
      });
      const second = buildAdminUserUpsertArgs({
        adminUserId: ADMIN_USER_ID,
        email: "admin@mail.langwatch.localhost",
        name: "Haven Local Admin",
      });

      expect(first).toEqual(second);
    });
  });
});
