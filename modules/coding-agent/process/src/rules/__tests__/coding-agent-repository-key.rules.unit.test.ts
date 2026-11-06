/**
 * @vitest-environment node
 * @see modules/coding-agent/specs/coding-agent-session-stored.feature
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { repositoryKeyOfWith } from "../coding-agent-repository-key.rules.ts";

const repository = {
  repositoryHost: "github.com",
  repositoryOwner: "acme",
  repositoryName: "payments",
};
const normalizeHost = (host: string) => host.toLowerCase() || "github.com";
const repositoryKeyOf = repositoryKeyOfWith({ secret: "server-secret", normalizeHost });

describe("repositoryKeyOfWith", () => {
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

  /** @scenario "A repo with no host named is the same repo as on the deployment's host" */
  it("gives a repo with no host the key of the same repo on the normalized host", () => {
    expect(repositoryKeyOf({ ...repository, repositoryHost: null })).toBe(
      repositoryKeyOf(repository),
    );
  });

  /** @scenario "A guessed repo name cannot be tested without the server's secret" */
  it("gives no key a plain hash of the guessed repo could match", () => {
    const guess = createHash("sha256").update("github.com\0acme\0payments").digest("hex");

    expect(repositoryKeyOf(repository)).not.toBe(guess);
  });

  it("gives another secret another key", () => {
    const other = repositoryKeyOfWith({ secret: "another-secret", normalizeHost });

    expect(other(repository)).not.toBe(repositoryKeyOf(repository));
  });

  /** @scenario "A deployment with no secret reports no repo key" */
  it("gives no key where the deployment holds no secret", () => {
    expect(repositoryKeyOfWith({ secret: "", normalizeHost })(repository)).toBeNull();
  });
});
