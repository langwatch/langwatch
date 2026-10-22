/**
 * @vitest-environment node
 * @see modules/auth/specs/forced-password-reset.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { UserRepository } from "../../repositories/user.repository.ts";
import {
  parsePasswordResetSelector,
  RequirePasswordResetTask,
} from "../require-password-reset.task.ts";

describe("the require-password-reset selector", () => {
  /** @scenario "The task refuses to run without saying whom to mark" */
  it("refuses to run with no selector and touches no user", async () => {
    // Any repository call would throw by name: the refusal comes first.
    const task = RequirePasswordResetTask.create({ users: createApiFixture<UserRepository>({}) });

    await expect(task.markForReset({ args: ["--dry-run"] })).rejects.toThrow(
      /--all-credential-users.*--email/,
    );
  });

  it("refuses both selectors at once", () => {
    expect(() =>
      parsePasswordResetSelector(["--all-credential-users", "--email", "a@acme.test"]),
    ).toThrow(/cannot be combined/);
  });

  it("reads repeated, comma separated and inline addresses", () => {
    expect(
      parsePasswordResetSelector([
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
