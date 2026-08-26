import { describe, expect, it } from "vitest";

import { GithubHostAdapter } from "../src/adapters/github-host.adapter";

type HostConfig = { host?: string };

function host(config: HostConfig = {}): GithubHostAdapter {
  return GithubHostAdapter.create(config);
}

function getGithubHost(config: HostConfig = {}): string {
  return host(config).getHost();
}

function getGithubApiBase(config: HostConfig = {}): string {
  return host(config).getApiBase();
}

function getGithubWebBase(config: HostConfig = {}): string {
  return host(config).getWebBase();
}

function getGithubAppInstallUrl(appSlug: string, config: HostConfig = {}): string {
  return host(config).getAppInstallUrl(appSlug);
}

function isMappableGithubHost(repositoryHost: string, config: HostConfig = {}): boolean {
  return host(config).isMappable(repositoryHost);
}

function normalizeGithubHost(repositoryHost: string, config: HostConfig = {}): string {
  return host(config).normalize(repositoryHost);
}

const GHES = "github.acme-corp.internal";

describe("the GitHub host this instance is bound to", () => {
  describe("given the instance names no GitHub host", () => {
    it("resolves github.com, its public API and its app page", () => {
      expect(getGithubHost()).toBe("github.com");
      expect(getGithubApiBase()).toBe("https://api.github.com");
      expect(getGithubWebBase()).toBe("https://github.com");
      expect(getGithubAppInstallUrl("langwatch-langy")).toBe(
        "https://github.com/apps/langwatch-langy/installations/new",
      );
    });

    it("treats an empty or blank value as no host at all", () => {
      expect(getGithubHost({ host: "" })).toBe("github.com");
      expect(getGithubHost({ host: "   " })).toBe("github.com");
    });

    it("maps an absent or case-varied session host onto github.com", () => {
      expect(normalizeGithubHost("")).toBe("github.com");
      expect(isMappableGithubHost("")).toBe(true);
      expect(isMappableGithubHost("github.com")).toBe(true);
      expect(isMappableGithubHost("GitHub.com")).toBe(true);
      expect(normalizeGithubHost("GitHub.com")).toBe("github.com");
      expect(isMappableGithubHost("gitlab.example.com")).toBe(false);
    });
  });

  describe("given the instance names a GitHub Enterprise Server host", () => {
    const config = { host: GHES };

    it("resolves that host, its API and its App page", () => {
      expect(getGithubHost(config)).toBe(GHES);
      expect(getGithubApiBase(config)).toBe(`https://${GHES}/api/v3`);
      expect(getGithubWebBase(config)).toBe(`https://${GHES}`);
      expect(getGithubAppInstallUrl("langwatch-langy", config)).toBe(
        `https://${GHES}/github-apps/langwatch-langy/installations/new`,
      );
    });

    it("folds the configured host's casing", () => {
      const upperConfig = { host: GHES.toUpperCase() };
      expect(getGithubHost(upperConfig)).toBe(GHES);
      expect(isMappableGithubHost(GHES, upperConfig)).toBe(true);
    });

    it("maps the configured host and a session that reported none", () => {
      expect(isMappableGithubHost(GHES, config)).toBe(true);
      expect(isMappableGithubHost(GHES.toUpperCase(), config)).toBe(true);
      expect(isMappableGithubHost("", config)).toBe(true);
      expect(normalizeGithubHost("", config)).toBe(GHES);
    });

    it("refuses github.com because the instance has no connection to it", () => {
      expect(isMappableGithubHost("github.com", config)).toBe(false);
    });

    it("escapes an app slug in the install link", () => {
      expect(getGithubAppInstallUrl("weird slug/../x", config)).toBe(
        `https://${GHES}/github-apps/weird%20slug%2F..%2Fx/installations/new`,
      );
    });
  });
});
