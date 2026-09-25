import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigCollisionError, ConfigParseError } from "../config.errors.ts";
import { Config, parseProcessConfig } from "../config.ts";
import { langevalsStagingTtlSeconds } from "../deployment-facts.ts";

const github = {
  name: "github",
  config: Config.define((c) => ({
    appId: c.env("GITHUB_APP_ID", z.string().optional()),
    apiUrl: c.env("GITHUB_API_URL", z.string().url().default("https://api.github.com")),
  })),
} as const;

describe("parseProcessConfig", () => {
  it("parses each owner's slice from the environment, keyed by owner name", () => {
    const config = parseProcessConfig({
      owners: [github],
      environment: { GITHUB_APP_ID: "1207" },
    });

    expect(config.github.appId).toBe("1207");
    expect(config.github.apiUrl).toBe("https://api.github.com");
  });

  /** @scenario "A missing required value refuses naming its root, its field and its variable" */
  it("refuses naming owner.path and the env var, every miss at once", () => {
    const strict = {
      name: "strict",
      config: Config.define((c) => ({
        one: c.env("STRICT_ONE", z.string()),
        nested: { two: c.env("STRICT_TWO", z.string()) },
      })),
    } as const;

    const refusalsOf = (run: () => unknown): readonly string[] => {
      try {
        run();
        return [];
      } catch (error) {
        return error instanceof ConfigParseError ? error.refusals : [];
      }
    };

    const refusals = refusalsOf(() => parseProcessConfig({ owners: [strict], environment: {} }));
    expect(refusals.some((line) => line.startsWith("strict.one ← STRICT_ONE"))).toBe(true);
    expect(refusals.some((line) => line.startsWith("strict.nested.two ← STRICT_TWO"))).toBe(true);
  });

  /** @scenario "Two meanings for one variable still refuse" */
  it("refuses two owners claiming one variable, however they spell it", () => {
    const a = {
      name: "a",
      config: Config.define((c) => ({ host: c.env("BASE_HOST", z.string().optional()) })),
    } as const;
    const b = {
      name: "b",
      config: Config.define((c) => ({ host: c.env("BASE_HOST", z.string().optional()) })),
    } as const;

    // One variable carries one meaning. The owner that declares it passes the
    // parsed value down; a second declaration is a second meaning, not sharing.
    expect(() => parseProcessConfig({ owners: [a, b], environment: {} })).toThrowError(
      ConfigCollisionError,
    );
  });

  describe("given two owners holding the one exported deployment-fact leaf", () => {
    /** @scenario "Owners sharing one deployment-fact leaf both parse it" */
    /** @scenario "One shared deployment fact may be claimed by several modules" */
    it("admits both claims and hands each owner the same parsed value", () => {
      const evaluation = {
        name: "evaluation",
        config: { ttl: langevalsStagingTtlSeconds },
      } as const;
      const workflow = { name: "workflow", config: { ttl: langevalsStagingTtlSeconds } } as const;

      const config = parseProcessConfig({
        owners: [evaluation, workflow],
        environment: { LANGEVALS_STAGING_TTL_SECONDS: "120" },
      });

      expect(config.evaluation.ttl).toBe(120);
      expect(config.workflow.ttl).toBe(120);
    });

    /** @scenario "A second leaf for a shared deployment fact still refuses" */
    it("refuses an owner declaring its own leaf for the same variable", () => {
      const evaluation = { name: "evaluation", config: { ttl: langevalsStagingTtlSeconds } };
      const rogue = {
        name: "rogue",
        config: Config.define((c) => ({ ttl: c.env("LANGEVALS_STAGING_TTL_SECONDS", z.string()) })),
      };

      expect(() => parseProcessConfig({ owners: [evaluation, rogue], environment: {} })).toThrow(
        expect.objectContaining({ code: "config_collision" }),
      );
    });
  });

  /** @scenario "The parsed configuration cannot be mutated" */
  it("returns frozen slices — the parse's answer is what the process holds", () => {
    const config = parseProcessConfig({ owners: [github], environment: {} });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.github)).toBe(true);
  });

  /** @scenario "A module that declares no config schema contributes nothing" */
  it("owns no slice for an owner that declares none", () => {
    const config = parseProcessConfig({ owners: [{ name: "bare" }], environment: {} });
    expect("bare" in config).toBe(false);
  });
});

describe("config and secrets stay separate", () => {
  /** @scenario "A module config schema may not declare a credential" */
  it("refuses a config leaf claiming an env name any owner declared as a secret", () => {
    const security = {
      name: "security",
      secrets: { key: { id: "SIGNING_KEY" } },
    } as const;
    const sneaky = {
      name: "sneaky",
      config: Config.define((c) => ({ key: c.env("SIGNING_KEY", z.string().optional()) })),
    } as const;

    expect(() => parseProcessConfig({ owners: [security, sneaky], environment: {} })).toThrowError(
      /"sneaky" declares "SIGNING_KEY" as config, but "security" declares it as a secret/,
    );
  });
});
