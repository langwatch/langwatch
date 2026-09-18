import { describe, expect, it } from "vitest";
import { z } from "zod";

import { deploymentPublicBaseUrl } from "../deployment-facts.ts";
import { defineProcessConfig } from "../process-config.ts";
import { Config, compileRuntimeConfig, InvalidRuntimeConfigError } from "../runtime-config.ts";

const processSchema = compileRuntimeConfig({
  port: Config.value(z.coerce.number().default(6560), { env: "API_PORT" }),
  serviceName: Config.value(z.string().default("langwatch-api")),
});

const traceSchema = compileRuntimeConfig({
  fallbackVisibilityDays: Config.value(z.coerce.number().default(14), {
    env: "TRACE_FALLBACK_VISIBILITY_DAYS",
  }),
});

const monitorSchema = compileRuntimeConfig({
  threshold: Config.value(z.coerce.number(), { env: "MONITOR_THRESHOLD" }),
});

describe("given a process that installs modules declaring config schemas", () => {
  describe("when the process configuration is parsed from the environment", () => {
    /** @scenario "The process and every installed module become one parsed object" */
    it("gives the process one root key and each declaring module its own", () => {
      const parse = defineProcessConfig({
        process: processSchema,
        modules: { trace: traceSchema, monitor: monitorSchema },
      });

      const config = parse({ API_PORT: "7000", MONITOR_THRESHOLD: "3" });

      expect(config).toEqual({
        process: { port: 7000, serviceName: "langwatch-api" },
        trace: { fallbackVisibilityDays: 14 },
        monitor: { threshold: 3 },
      });
      expect(Object.keys(config).toSorted()).toEqual(["monitor", "process", "trace"]);
    });

    /** @scenario "A module that declares no config schema contributes nothing" */
    it("carries no root key for a module that declares no schema", () => {
      const parse = defineProcessConfig({ process: processSchema, modules: { trace: traceSchema } });

      expect(Object.keys(parse({})).toSorted()).toEqual(["process", "trace"]);
    });

    /** @scenario "The parsed configuration cannot be mutated" */
    it("refuses an assignment to one of its root keys", () => {
      const parse = defineProcessConfig({ process: processSchema, modules: { trace: traceSchema } });
      const config = parse({});

      expect(() => {
        Object.assign(config, { trace: { fallbackVisibilityDays: 1 } });
      }).toThrow(TypeError);
      expect(config.trace.fallbackVisibilityDays).toBe(14);
    });
  });

  describe("when a required value is missing from the environment", () => {
    /** @scenario "A missing required value refuses naming its root, its field and its variable" */
    it("names the module root, the field and the environment variable", () => {
      const parse = defineProcessConfig({
        process: processSchema,
        modules: { monitor: monitorSchema },
      });

      expect(() => parse({})).toThrow(InvalidRuntimeConfigError);
      expect(() => parse({})).toThrow(/monitor\.threshold \(MONITOR_THRESHOLD/);
    });
  });
});

describe("given a module config schema that binds a classified variable", () => {
  describe("when the process configuration is declared", () => {
    /** @scenario "A module config schema may not declare a credential" */
    it("refuses a secret, naming the module, the field and the variable", () => {
      const declare = () =>
        defineProcessConfig({
          process: processSchema,
          modules: {
            github: compileRuntimeConfig({
              privateKey: Config.optionalSecret({ env: "GITHUB_LANGY_PRIVATE_KEY" }),
            }),
          },
        });

      expect(declare).toThrow(/github\.privateKey \(GITHUB_LANGY_PRIVATE_KEY, secret\)/);
      expect(declare).toThrow(/injected into the thing that uses it at construction/);
    });

    /** @scenario "A module config schema may not declare a connection string" */
    it("refuses a composite, naming the module, the field and the variable", () => {
      const declare = () =>
        defineProcessConfig({
          process: processSchema,
          modules: {
            notification: compileRuntimeConfig({
              smtp: Config.value(z.string().optional(), { env: "SMTP_URL" }),
            }),
          },
        });

      expect(declare).toThrow(/notification\.smtp \(SMTP_URL, composite\)/);
    });

    /** @scenario "The process root may read a classified variable through the secrets chain" */
    it("accepts the same classification on the process root", () => {
      const parse = defineProcessConfig({
        process: compileRuntimeConfig({
          credentialsSecret: Config.value(z.string().optional(), { env: "CREDENTIALS_SECRET" }),
        }),
        modules: {},
      });

      expect(parse({ CREDENTIALS_SECRET: "resolved-by-the-chain" })).toEqual({
        process: { credentialsSecret: "resolved-by-the-chain" },
      });
    });
  });
});

describe("given two modules that bind the same environment variable", () => {
  describe("when they share one canonical deployment leaf", () => {
    /** @scenario "One shared deployment fact may be claimed by several modules" */
    it("gives both modules the same value from the one variable", () => {
      const parse = defineProcessConfig({
        process: processSchema,
        modules: {
          github: compileRuntimeConfig({ publicBaseUrl: deploymentPublicBaseUrl }),
          trace: compileRuntimeConfig({ publicBaseUrl: deploymentPublicBaseUrl }),
        },
      });

      const config = parse({ BASE_HOST: "https://app.example.com" });

      expect(config.github.publicBaseUrl).toBe("https://app.example.com");
      expect(config.trace.publicBaseUrl).toBe("https://app.example.com");
    });
  });

  describe("when they mean two different things by it", () => {
    /** @scenario "Two meanings for one variable still refuse" */
    it("refuses, naming the variable and both claimants", () => {
      const declare = () =>
        defineProcessConfig({
          process: processSchema,
          modules: {
            github: compileRuntimeConfig({
              publicBaseUrl: Config.value(z.string().optional(), { env: "BASE_HOST" }),
            }),
            trace: compileRuntimeConfig({
              hostname: Config.value(z.string().optional(), { env: "BASE_HOST" }),
            }),
          },
        });

      expect(declare).toThrow(/trace\.hostname \(BASE_HOST\) is already bound by github\.publicBaseUrl/);
    });
  });
});

describe("given a module named after the process root", () => {
  describe("when the process configuration is declared", () => {
    /** @scenario "A module may not take the process's own root key" */
    it("refuses rather than letting the module overwrite the process values", () => {
      expect(() =>
        defineProcessConfig({ process: processSchema, modules: { process: traceSchema } }),
      ).toThrow(/A module may not be named "process"/);
    });
  });
});
