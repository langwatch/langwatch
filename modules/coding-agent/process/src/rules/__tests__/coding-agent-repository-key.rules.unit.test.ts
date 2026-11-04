/**
 * @vitest-environment node
 * @see modules/coding-agent/specs/coding-agent-session-stored.feature
 */
import { describe, expect, it } from "vitest";

import { repositoryKeyOf } from "../coding-agent-repository-key.rules.ts";

const repository = {
  repositoryHost: "github.com",
  repositoryOwner: "acme",
  repositoryName: "payments",
};

describe("repositoryKeyOf", () => {
  /** @scenario "A repo's key ignores case and differs per repo" */
  it("gives two spellings of one repo one key", () => {
    expect(repositoryKeyOf({ ...repository, repositoryOwner: "ACME" })).toBe(
      repositoryKeyOf(repository),
    );
  });

  it("gives another repo another key", () => {
    expect(repositoryKeyOf({ ...repository, repositoryName: "billing" })).not.toBe(
      repositoryKeyOf(repository),
    );
  });

  it("holds nothing readable of the repo", () => {
    expect(repositoryKeyOf(repository)).toMatch(/^[0-9a-f]{64}$/);
  });
});
