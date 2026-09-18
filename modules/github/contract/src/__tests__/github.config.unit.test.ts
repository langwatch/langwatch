import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { githubConfig } from "../github.config.ts";

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
});
