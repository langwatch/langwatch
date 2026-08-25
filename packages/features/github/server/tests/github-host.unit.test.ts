import { describe, expect, it } from "vitest";

import {
  getGithubApiBase,
  getGithubAppInstallUrl,
  getGithubHost,
  isMappableGithubHost,
} from "../src/adapters/github.github-host.adapter";

describe("GithubHost", () => {
  it("defaults to github.com", () => {
    expect(getGithubHost()).toBe("github.com");
    expect(getGithubApiBase()).toBe("https://api.github.com");
    expect(getGithubAppInstallUrl("langwatch-langy")).toContain(
      "/apps/langwatch-langy/installations/new",
    );
  });

  it("supports GitHub Enterprise Server", () => {
    const config = { host: "GitHub.example.test" };
    expect(getGithubHost(config)).toBe("github.example.test");
    expect(getGithubApiBase(config)).toBe("https://github.example.test/api/v3");
    expect(isMappableGithubHost("GITHUB.EXAMPLE.TEST", config)).toBe(true);
  });
});
