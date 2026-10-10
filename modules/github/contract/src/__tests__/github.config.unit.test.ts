import { parseProcessConfig } from "@langwatch/config";
import { credentialsSecret, sessionSecret } from "@langwatch/secrets/shared-secrets";
import { describe, expect, it } from "vitest";

import { githubConfig, githubSecrets } from "../github.config.ts";

const read = (source: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "github", config: githubConfig }],
    environment: source,
  }).github;

describe("github server configuration", () => {
  describe("given a deployment connected a GitHub App", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads every leaf, with the Enterprise Server host optional", () => {
      expect(read({ GITHUB_LANGY_APP_ID: "12345", GITHUB_LANGY_HOST: "github.acme.test" })).toEqual(
        {
          appId: "12345",
          host: "github.acme.test",
          appSlug: undefined,
        },
      );
    });
  });

  describe("given the install-state signing key", () => {
    it("holds the shared CREDENTIALS_SECRET and NEXTAUTH_SECRET handles, so a double claim passes", () => {
      expect(githubSecrets.signingKey).toBe(credentialsSecret);
      expect(githubSecrets.signingKeyFallback).toBe(sessionSecret);
    });
  });
});
