import type { OrganizationSsoProviderLookup } from "@ee/sso/matching";
import { describe, expect, it } from "vitest";

import {
  type CandidateUserPage,
  clearStalePendingSsoSetup,
  type PendingSsoSetupWriter,
} from "../clearStalePendingSsoSetup";

interface FakeUser {
  id: string;
  email: string | null;
  accounts: { provider: string; providerAccountId: string }[];
}

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: "user-1",
    email: "member@acme.com",
    accounts: [],
    ...overrides,
  };
}

/** Pages through an in-memory list the same way the Prisma cursor query would. */
function makeUsers(all: FakeUser[]): CandidateUserPage {
  return {
    async findPendingSsoSetupPage({ cursorId, take }) {
      const startIndex = cursorId
        ? all.findIndex((u) => u.id === cursorId) + 1
        : 0;
      return all.slice(startIndex, startIndex + take);
    },
  };
}

function makeWriter() {
  const cleared = new Set<string>();
  const writer: PendingSsoSetupWriter = {
    async clearPendingSsoSetup({ id }) {
      cleared.add(id);
    },
  };
  return { writer, cleared };
}

/** An org lookup that fails the test if called more than once per domain. */
function makeOrganizations({ ssoProvider }: { ssoProvider: string | null }): {
  organizations: OrganizationSsoProviderLookup;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    organizations: {
      async findByDomain({ domain }) {
        calls.push(domain);
        return { id: "org-1", name: "Acme", ssoProvider };
      },
    },
  };
}

describe("clearStalePendingSsoSetup", () => {
  describe("given a flagged user holding a matching account", () => {
    /** @scenario "A one-off cleanup clears the reminder for members who already sign in the right way" */
    it("clears the flag and counts it as cleared", async () => {
      const user = makeUser({
        accounts: [{ provider: "google", providerAccountId: "sub-123" }],
      });
      const { writer, cleared } = makeWriter();
      const { organizations } = makeOrganizations({ ssoProvider: "google" });

      const result = await clearStalePendingSsoSetup({
        users: makeUsers([user]),
        writer,
        organizations,
        dryRun: false,
      });

      expect(cleared.has(user.id)).toBe(true);
      expect(result).toEqual({
        scanned: 1,
        cleared: 1,
        stillPending: 0,
        skipped: 0,
        failed: 0,
        dryRun: false,
      });
    });
  });

  describe("given a flagged user with no matching account", () => {
    /** @scenario "The cleanup leaves the reminder for members who have not yet signed in the right way" */
    it("leaves the flag untouched and counts it as still pending", async () => {
      const user = makeUser({
        accounts: [{ provider: "credentials", providerAccountId: "user-1" }],
      });
      const { writer, cleared } = makeWriter();
      const { organizations } = makeOrganizations({ ssoProvider: "google" });

      const result = await clearStalePendingSsoSetup({
        users: makeUsers([user]),
        writer,
        organizations,
        dryRun: false,
      });

      expect(cleared.size).toBe(0);
      expect(result).toEqual({
        scanned: 1,
        cleared: 0,
        stillPending: 1,
        skipped: 0,
        failed: 0,
        dryRun: false,
      });
    });
  });

  describe("given a flagged user with no email", () => {
    it("skips the user without evaluating the matcher", async () => {
      const user = makeUser({ email: null });
      const { writer, cleared } = makeWriter();
      const { organizations, calls } = makeOrganizations({
        ssoProvider: "google",
      });

      const result = await clearStalePendingSsoSetup({
        users: makeUsers([user]),
        writer,
        organizations,
        dryRun: false,
      });

      expect(cleared.size).toBe(0);
      expect(calls).toHaveLength(0);
      expect(result).toMatchObject({ scanned: 1, skipped: 1, cleared: 0 });
    });
  });

  describe("when running in dry-run mode", () => {
    it("writes nothing but reports the same counts as a live run", async () => {
      const matching = makeUser({
        id: "user-1",
        accounts: [{ provider: "google", providerAccountId: "sub-1" }],
      });
      const nonMatching = makeUser({
        id: "user-2",
        accounts: [],
      });
      const { writer, cleared } = makeWriter();
      const { organizations } = makeOrganizations({ ssoProvider: "google" });

      const result = await clearStalePendingSsoSetup({
        users: makeUsers([matching, nonMatching]),
        writer,
        organizations,
        dryRun: true,
      });

      expect(cleared.size).toBe(0);
      expect(result).toEqual({
        scanned: 2,
        cleared: 1,
        stillPending: 1,
        skipped: 0,
        failed: 0,
        dryRun: true,
      });
    });
  });

  describe("given several flagged users sharing the same email domain", () => {
    it("looks the organization up once for the whole run", async () => {
      const users = [
        makeUser({
          id: "user-1",
          accounts: [{ provider: "google", providerAccountId: "sub-1" }],
        }),
        makeUser({
          id: "user-2",
          accounts: [{ provider: "google", providerAccountId: "sub-2" }],
        }),
        makeUser({
          id: "user-3",
          accounts: [],
        }),
      ];
      const { writer } = makeWriter();
      const { organizations, calls } = makeOrganizations({
        ssoProvider: "google",
      });

      await clearStalePendingSsoSetup({
        users: makeUsers(users),
        writer,
        organizations,
        dryRun: false,
      });

      expect(calls).toEqual(["acme.com"]);
    });
  });

  describe("given one user fails to process", () => {
    it("counts the failure and still processes the remaining users", async () => {
      const failing = makeUser({
        id: "user-1",
        accounts: [{ provider: "google", providerAccountId: "sub-1" }],
      });
      const okay = makeUser({
        id: "user-2",
        accounts: [{ provider: "google", providerAccountId: "sub-2" }],
      });
      const { cleared } = makeWriter();
      const writer: PendingSsoSetupWriter = {
        async clearPendingSsoSetup({ id }) {
          if (id === failing.id) {
            throw new Error("write conflict");
          }
          cleared.add(id);
        },
      };
      const { organizations } = makeOrganizations({ ssoProvider: "google" });

      const result = await clearStalePendingSsoSetup({
        users: makeUsers([failing, okay]),
        writer,
        organizations,
        dryRun: false,
      });

      expect(cleared.has(okay.id)).toBe(true);
      expect(result).toEqual({
        scanned: 2,
        cleared: 1,
        stillPending: 0,
        skipped: 0,
        failed: 1,
        dryRun: false,
      });
    });
  });

  describe("given a user already cleared by a previous run", () => {
    it("finds nothing to do on a second run", async () => {
      // The candidate page always reflects `pendingSsoSetup: true` — a
      // cleared user simply no longer appears in it, so a second run over
      // the (now empty) candidate set is a no-op.
      const { writer, cleared } = makeWriter();
      const { organizations } = makeOrganizations({ ssoProvider: "google" });

      const result = await clearStalePendingSsoSetup({
        users: makeUsers([]),
        writer,
        organizations,
        dryRun: false,
      });

      expect(cleared.size).toBe(0);
      expect(result).toEqual({
        scanned: 0,
        cleared: 0,
        stillPending: 0,
        skipped: 0,
        failed: 0,
        dryRun: false,
      });
    });
  });
});
