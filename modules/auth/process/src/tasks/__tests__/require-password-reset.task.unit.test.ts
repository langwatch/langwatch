/**
 * @vitest-environment node
 * The require-password-reset task over a user module double that holds its marks in memory, and
 * a session double that records whose sessions it ended.
 * @see modules/auth/specs/forced-password-reset.feature
 */
import type { AuthApi } from "@langwatch/auth-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { PasswordHolder, UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import {
  parsePasswordResetSelector,
  RequirePasswordResetTask,
} from "../require-password-reset.task.ts";

type Seed = { id: string; email: string; markedForReset?: boolean };

/** Holders of a credential password, matched by address in any case, as the user module does. */
function world(seeds: readonly Seed[]) {
  const holders: PasswordHolder[] = seeds.map((seed) => ({
    id: seed.id,
    email: seed.email,
    markedForReset: seed.markedForReset ?? false,
  }));
  const markCalls: string[][] = [];
  const revoked: string[] = [];
  const cliRevoked: string[] = [];
  const users = createApiFixture<UserApi>({
    findPasswordHolders: async ({ emails }) => {
      const wanted = emails === null ? null : new Set(emails.map((e) => e.toLowerCase()));
      return holders
        .filter((holder) => wanted === null || wanted.has(holder.email?.toLowerCase() ?? ""))
        .map((holder) => ({ ...holder }));
    },
    markPasswordResetRequired: async ({ userIds }) => {
      markCalls.push([...userIds]);
      const fresh = holders.filter((h) => userIds.includes(h.id) && !h.markedForReset);
      for (const holder of fresh) holder.markedForReset = true;
      return { marked: fresh.length };
    },
  });
  const sessions = createApiFixture<AuthApi>({
    revokeAllBrowserSessions: async ({ userId }) => {
      revoked.push(userId);
    },
    revokeCliTokens: async ({ userId }) => {
      cliRevoked.push(userId);
      return { revokedCount: 2 };
    },
  });
  const task = RequirePasswordResetTask.create({ users, sessions });
  const marked = () => holders.filter((h) => h.markedForReset).map((h) => h.id);
  return { task, markCalls, revoked, cliRevoked, marked };
}

describe("the require-password-reset selector", () => {
  /** @scenario "The task refuses to run without saying whom to mark" */
  it("refuses to run with no selector and touches no user", async () => {
    // Any user or session call would throw by name: the refusal comes first.
    const task = RequirePasswordResetTask.create({
      users: createApiFixture<UserApi>({}),
      sessions: createApiFixture<AuthApi>({}),
    });

    await expect(task.markForReset({ args: ["--dry-run"] })).rejects.toThrow(
      /--all-credential-users.*--email/,
    );
  });

  it("refuses both selectors at once", () => {
    expect(() =>
      parsePasswordResetSelector(["--all-credential-users", "--email", "a@acme.test"]),
    ).toThrow(/cannot be combined/);
  });

  /** @scenario "A misspelled flag is refused before anyone is marked" */
  it("refuses a misspelled flag, so a mistyped dry run never marks anyone", async () => {
    const { task, markCalls, revoked } = world([{ id: "u1", email: "a@acme.test" }]);

    await expect(
      task.markForReset({ args: ["--all-credential-users", "--dryrun"] }),
    ).rejects.toThrow(/Unknown argument --dryrun/);
    expect(() => parsePasswordResetSelector(["--all-credential-users", "--dry_run"])).toThrow(
      /Unknown argument --dry_run/,
    );
    expect(markCalls).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it("reads repeated, comma separated and inline addresses past the argument separator", () => {
    expect(
      parsePasswordResetSelector([
        "--",
        "--email",
        "a@acme.test,b@acme.test",
        "--email=c@acme.test",
        "--dry-run",
      ]),
    ).toEqual({ kind: "emails", emails: ["a@acme.test", "b@acme.test", "c@acme.test"] });
    expect(parsePasswordResetSelector(["--all-credential-users"])).toEqual({
      kind: "all_credential_users",
    });
  });
});

describe("the require-password-reset task", () => {
  /** @scenario "The task marks every user who holds a password" */
  it("marks every password holder the user module finds", async () => {
    const { task, marked } = world([
      { id: "u1", email: "a@acme.test" },
      { id: "u2", email: "b@acme.test" },
    ]);

    const report = await task.markForReset({ args: ["--all-credential-users"] });

    expect(report).toMatchObject({ mode: "execute", matched: 2, newlyMarked: 2, alreadyMarked: 0 });
    expect(marked()).toEqual(["u1", "u2"]);
  });

  /** @scenario "The task marks only the users named by email" */
  it("marks only the named holder, whatever case the address was typed in", async () => {
    const { task, marked } = world([
      { id: "named", email: "Named@Acme.test" },
      { id: "other", email: "other@acme.test" },
    ]);

    const report = await task.markForReset({ args: ["--email", "NAMED@acme.TEST"] });

    expect(report).toMatchObject({ matched: 1, newlyMarked: 1, notMarkedEmails: [] });
    expect(marked()).toEqual(["named"]);
  });

  /** @scenario "A dry run counts and writes nothing" */
  it("counts the users it would mark and neither marks nor ends a session", async () => {
    const { task, markCalls, revoked, cliRevoked } = world([
      { id: "u1", email: "a@acme.test" },
      { id: "u2", email: "b@acme.test", markedForReset: true },
    ]);

    const report = await task.markForReset({ args: ["--all-credential-users", "--dry-run"] });

    expect(report).toEqual({
      mode: "dry-run",
      matched: 2,
      newlyMarked: 1,
      alreadyMarked: 1,
      sessionsRevokedFor: 0,
      cliTokensRevoked: 0,
      notMarkedEmails: [],
    });
    expect(markCalls).toEqual([]);
    expect(revoked).toEqual([]);
    expect(cliRevoked).toEqual([]);
  });

  /** @scenario "Marking a user ends their sessions" */
  it("ends the browser sessions and CLI logins of every matched user, already marked ones too", async () => {
    const { task, revoked, cliRevoked } = world([
      { id: "fresh", email: "fresh@acme.test" },
      { id: "earlier", email: "earlier@acme.test", markedForReset: true },
    ]);

    const report = await task.markForReset({ args: ["--all-credential-users"] });

    expect(report).toMatchObject({
      newlyMarked: 1,
      alreadyMarked: 1,
      sessionsRevokedFor: 2,
      cliTokensRevoked: 4,
    });
    expect(revoked.toSorted()).toEqual(["earlier", "fresh"]);
    expect(cliRevoked.toSorted()).toEqual(["earlier", "fresh"]);
  });

  /** @scenario "Running the task again keeps the first mark" */
  it("marks nobody twice on a second run", async () => {
    const { task } = world([{ id: "u1", email: "a@acme.test" }]);
    await task.markForReset({ args: ["--email", "a@acme.test"] });

    const report = await task.markForReset({ args: ["--email", "a@acme.test"] });

    expect(report).toMatchObject({ matched: 1, newlyMarked: 0, alreadyMarked: 1 });
  });

  /** @scenario "The task reports addresses that hold no password" */
  it("reports named addresses that matched no holder, and marks nobody", async () => {
    // A provider-only account holds no password, so the user module finds no holder for it.
    const { task, marked, revoked } = world([{ id: "u1", email: "holder@acme.test" }]);

    const report = await task.markForReset({
      args: ["--email", "unknown@acme.test", "--email", "provider-only@acme.test"],
    });

    expect(report).toMatchObject({ matched: 0, newlyMarked: 0 });
    expect(report.notMarkedEmails).toEqual(["unknown@acme.test", "provider-only@acme.test"]);
    expect(marked()).toEqual([]);
    expect(revoked).toEqual([]);
  });
});
