import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigCollisionError, ConfigParseError } from "../config.errors.ts";
import { Config, parseProcessConfig } from "../config.ts";

const github = {
  name: "github",
  config: {
    appId: Config.env("GITHUB_APP_ID", z.string().optional()),
    apiUrl: Config.env("GITHUB_API_URL", z.string().url().default("https://api.github.com")),
  },
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

  it("refuses naming owner.path and the env var, every miss at once", () => {
    const strict = {
      name: "strict",
      config: {
        one: Config.env("STRICT_ONE", z.string()),
        nested: { two: Config.env("STRICT_TWO", z.string()) },
      },
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

  it("accepts one shared leaf under many owners, refuses two meanings for one var", () => {
    const baseHost = Config.env("BASE_HOST", z.string().optional());
    const a = { name: "a", config: { host: baseHost } } as const;
    const b = { name: "b", config: { host: baseHost } } as const;

    const config = parseProcessConfig({ owners: [a, b], environment: { BASE_HOST: "x.test" } });
    expect(config.a.host).toBe("x.test");
    expect(config.b.host).toBe("x.test");

    const rival = { name: "c", config: { host: Config.env("BASE_HOST", z.string()) } } as const;
    expect(() => parseProcessConfig({ owners: [a, rival], environment: {} })).toThrowError(
      ConfigCollisionError,
    );
  });

  it("returns frozen slices — the parse's answer is what the process holds", () => {
    const config = parseProcessConfig({ owners: [github], environment: {} });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.github)).toBe(true);
  });

  it("owns no slice for an owner that declares none", () => {
    const config = parseProcessConfig({ owners: [{ name: "bare" }], environment: {} });
    expect("bare" in config).toBe(false);
  });
});

describe("the wall between config and secrets", () => {
  it("refuses a config leaf claiming an env name any owner declared as a secret", () => {
    const security = {
      name: "security",
      secrets: { key: { id: "SIGNING_KEY" } },
    } as const;
    const sneaky = {
      name: "sneaky",
      config: { key: Config.env("SIGNING_KEY", z.string().optional()) },
    } as const;

    expect(() => parseProcessConfig({ owners: [security, sneaky], environment: {} })).toThrowError(
      /"sneaky" declares "SIGNING_KEY" as config, but "security" declares it as a secret/,
    );
  });
});
