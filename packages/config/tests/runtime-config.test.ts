import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Config,
  ConfigValue,
  compileRuntimeConfig,
  environmentBooleanSchema,
  InvalidRuntimeConfigError,
  portSchema,
  RuntimeConfig,
} from "../src";

const serviceSchema = z.object({
  PORT: portSchema.default(5_560),
  ENABLED: environmentBooleanSchema.default(false),
});

function unsupportedConfigValueFixture() {
  // @ts-expect-error Config.value accepts primitive defaults or explicit Zod schemas.
  return Config.value({ unsupported: true });
}

void unsupportedConfigValueFixture;

describe("RuntimeConfig", () => {
  it("resolves nested semantic definitions from environment bindings", () => {
    const definition = RuntimeConfig.define({
      rateLimit: { ttlMs: 15_000, enabled: true },
      endpoint: Config.url({ optional: true }),
    });

    const config = RuntimeConfig.create({
      name: "nested service",
      definition,
      source: {
        RATE_LIMIT_TTL_MS: "2500",
        RATE_LIMIT_ENABLED: "false",
        ENDPOINT: "https://example.test",
      },
    });

    expect(config.value).toEqual({
      rateLimit: { ttlMs: 2500, enabled: false },
      endpoint: "https://example.test",
    });
    const ttlMs: number = config.value.rateLimit.ttlMs;
    const enabled: boolean = config.value.rateLimit.enabled;
    const endpoint: string | undefined = config.value.endpoint;
    const nestedValues: {
      rateLimit: { ttlMs: number; enabled: boolean };
      endpoint: string | undefined;
    } = config.value;
    void ttlMs;
    void enabled;
    void endpoint;
    void nestedValues;
    expect(Object.isFrozen(config.value.rateLimit)).toBe(true);
    expect(config.schema.parse(config.value)).toEqual(config.value);
    expect(
      compileRuntimeConfig(definition).parse({
        rateLimit: { ttlMs: 123, enabled: true },
        endpoint: "https://example.test",
      }),
    ).toEqual({
      rateLimit: { ttlMs: 123, enabled: true },
      endpoint: "https://example.test",
    });
  });

  it("exports the inferred value shape for service factories", () => {
    const definition = RuntimeConfig.define({
      endpoint: Config.url({ optional: true }),
      token: Config.secret({ optional: true }),
      retries: Config.integer(2),
      region: Config.value("local"),
    });

    type ServiceConfig = ConfigValue<typeof definition>;
    type ExpectedServiceConfig = {
      endpoint: string | undefined;
      token: string | undefined;
      retries: number;
      region: string;
    };
    const serviceConfig = {} as ServiceConfig;
    const expected: ExpectedServiceConfig = serviceConfig;
    const roundTrip: ServiceConfig = expected;
    void expected;
    void roundTrip;
    expect(definition).toHaveProperty("endpoint");
  });

  it("rejects duplicate normalized environment bindings", () => {
    expect(() =>
      RuntimeConfig.create({
        name: "duplicate service",
        definition: { fooBar: 1, foo_bar: 2 },
        source: {},
      }),
    ).toThrow("Duplicate configuration environment binding: FOO_BAR");
  });

  it("supports required and defaulted semantic leaves", () => {
    const definition = RuntimeConfig.define({
      requiredPort: Config.integer(),
      retries: Config.integer(3),
      region: Config.value("local"),
    });
    const config = RuntimeConfig.create({
      name: "leaf service",
      definition,
      source: { REQUIRED_PORT: "8080" },
    });

    expect(config.value).toEqual({
      requiredPort: 8080,
      retries: 3,
      region: "local",
    });
  });

  /** @scenario Schema defaults make a local service bootable */
  it("uses defaults declared beside the service schema", () => {
    const config = RuntimeConfig.create({
      name: "example service",
      schema: serviceSchema,
      source: {},
    });

    expect(config.value).toEqual({ PORT: 5_560, ENABLED: false });
  });

  /** @scenario A runtime parses only its own schema */
  it("normalizes values and strips unrelated environment entries", () => {
    const config = RuntimeConfig.create({
      name: "example service",
      schema: serviceSchema,
      source: {
        PORT: "6560",
        ENABLED: "false",
        UNRELATED_SECRET: "must-not-cross-the-boundary",
      },
    });

    expect(config.value).toEqual({ PORT: 6_560, ENABLED: false });
    expect(config.value).not.toHaveProperty("UNRELATED_SECRET");
  });

  /** @scenario Invalid runtime configuration fails before service construction */
  it("reports paths and issue codes without echoing source values", () => {
    let error: unknown;
    try {
      RuntimeConfig.create({
        name: "example service",
        schema: serviceSchema,
        source: { PORT: "a-secret-looking-invalid-value" },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidRuntimeConfigError);
    expect(error).toMatchObject({
      runtime: "example service",
      issues: [{ path: "PORT", code: "invalid_type" }],
    });
    expect(String(error)).not.toContain("a-secret-looking-invalid-value");
  });
});
