import { describe, expect, it } from "vitest";

import {
  SEED_GITHUB_INSTALLATION,
  SEED_GITHUB_PULL_REQUESTS,
  SEED_GITHUB_REPOSITORY,
} from "../seed-github-fixture.ts";

describe("the demo preset's GitHub fixture", () => {
  /** @scenario The demo preset maps pull requests to a seeded GitHub connection */
  it("stores the repository lowercased, as every pull-request lookup asks for it", () => {
    expect(SEED_GITHUB_REPOSITORY).toBe(SEED_GITHUB_REPOSITORY.toLowerCase());
  });

  it("covers the pull requests' repository with its installation", () => {
    expect(SEED_GITHUB_INSTALLATION.repositories.map((repository) => repository.fullName)).toEqual([
      SEED_GITHUB_REPOSITORY,
    ]);
  });

  it("maps telemetrysim's claude-code-events branch to an open pull request", () => {
    const open = SEED_GITHUB_PULL_REQUESTS.filter((pullRequest) => pullRequest.state === "open");
    expect(open.map((pullRequest) => pullRequest.headBranch)).toEqual(["fix/flaky-checkout-test"]);
  });

  it("gives each pull request its own number", () => {
    const numbers = SEED_GITHUB_PULL_REQUESTS.map((pullRequest) => pullRequest.prNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
