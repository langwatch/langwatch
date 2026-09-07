import { InvalidRuntimeConfigError, RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { githubServerConfigDefinition } from "../github.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "github", definition: githubServerConfigDefinition, source }).value;

describe("github server configuration", () => {
  describe("given a deployment connected a GitHub App", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads every leaf, with the Enterprise Server host optional", () => {
      expect(read({ GITHUB_LANGY_APP_ID: "12345", GITHUB_LANGY_HOST: "github.acme.test" })).toEqual(
        {
          appId: "12345",
          host: "github.acme.test",
          privateKey: undefined,
          appSlug: undefined,
          webhookSecret: undefined,
        },
      );
    });
  });

  describe("given the private key is exported blank", () => {
    /** @scenario "An unreadable switch is refused instead of read as off" */
    it("refuses the boot rather than reading it as no connection", () => {
      expect(() => read({ GITHUB_LANGY_PRIVATE_KEY: "" })).toThrow(InvalidRuntimeConfigError);
    });
  });
});
