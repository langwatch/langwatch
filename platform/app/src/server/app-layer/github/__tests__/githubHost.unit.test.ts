/**
 * @vitest-environment node
 * @unit
 *
 * The GitHub host an instance is bound to, and the URLs derived from it. The
 * default matters as much as the setting: an instance that names no host has to
 * behave exactly as it did before the setting existed.
 *
 * @see specs/integrations/github-connection.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level declarations, so the mutable
// env object has to come from vi.hoisted to exist when the factory runs.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { GITHUB_LANGY_HOST: undefined as string | undefined },
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

import {
  getGithubApiBase,
  getGithubAppInstallUrl,
  getGithubHost,
  getGithubWebBase,
  isMappableGithubHost,
  normalizeGithubHost,
} from "../githubHost";

const GHES = "github.acme-corp.internal";

describe("the GitHub host this instance is bound to", () => {
  beforeEach(() => {
    mockEnv.GITHUB_LANGY_HOST = undefined;
  });

  describe("given the instance names no GitHub host", () => {
    /** @scenario "An instance that names no host talks to github.com" */
    it("resolves github.com, its public API and its app page", () => {
      expect(getGithubHost()).toBe("github.com");
      expect(getGithubApiBase()).toBe("https://api.github.com");
      expect(getGithubWebBase()).toBe("https://github.com");
      expect(getGithubAppInstallUrl("langwatch-langy")).toBe(
        "https://github.com/apps/langwatch-langy/installations/new",
      );
    });

    it("treats an empty or blank value as no host at all", () => {
      mockEnv.GITHUB_LANGY_HOST = "";
      expect(getGithubHost()).toBe("github.com");
      mockEnv.GITHUB_LANGY_HOST = "   ";
      expect(getGithubHost()).toBe("github.com");
    });

    it("maps a session that reported no host onto github.com", () => {
      expect(normalizeGithubHost("")).toBe("github.com");
      expect(isMappableGithubHost("")).toBe(true);
      expect(isMappableGithubHost("github.com")).toBe(true);
      // A host is case insensitive, and a session records whatever casing its
      // git remote carried.
      expect(isMappableGithubHost("GitHub.com")).toBe(true);
      expect(normalizeGithubHost("GitHub.com")).toBe("github.com");
      expect(isMappableGithubHost("gitlab.example.com")).toBe(false);
    });
  });

  describe("given the instance names a GitHub Enterprise Server host", () => {
    beforeEach(() => {
      mockEnv.GITHUB_LANGY_HOST = GHES;
    });

    /** @scenario "An instance that names an Enterprise Server host talks to that host" */
    it("resolves that host, its /api/v3 base and its /github-apps page", () => {
      expect(getGithubHost()).toBe(GHES);
      // Enterprise Server serves the REST API on the instance itself, not on a
      // separate api. hostname.
      expect(getGithubApiBase()).toBe(`https://${GHES}/api/v3`);
      expect(getGithubWebBase()).toBe(`https://${GHES}`);
      // And it serves an App's public page under /github-apps/, not /apps/.
      expect(getGithubAppInstallUrl("langwatch-langy")).toBe(
        `https://${GHES}/github-apps/langwatch-langy/installations/new`,
      );
    });

    it("folds the configured host's own casing", () => {
      mockEnv.GITHUB_LANGY_HOST = GHES.toUpperCase();

      expect(getGithubHost()).toBe(GHES);
      expect(isMappableGithubHost(GHES)).toBe(true);
    });

    it("maps a repository on that host, and one that reported no host", () => {
      expect(isMappableGithubHost(GHES)).toBe(true);
      expect(isMappableGithubHost(GHES.toUpperCase())).toBe(true);
      // No host reported means the only GitHub this instance knows about.
      expect(isMappableGithubHost("")).toBe(true);
      expect(normalizeGithubHost("")).toBe(GHES);
    });

    it("refuses github.com, which this instance has no connection to", () => {
      expect(isMappableGithubHost("github.com")).toBe(false);
    });

    it("escapes an app slug into the install link", () => {
      expect(getGithubAppInstallUrl("weird slug/../x")).toBe(
        `https://${GHES}/github-apps/weird%20slug%2F..%2Fx/installations/new`,
      );
    });
  });
});
