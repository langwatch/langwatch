import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  environmentBooleanSchema,
  InvalidRuntimeConfigError,
  portSchema,
  RuntimeConfig,
} from "../src";

const serviceSchema = z.object({
  PORT: portSchema.default(5_560),
  ENABLED: environmentBooleanSchema.default(false),
});

describe("RuntimeConfig", () => {
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
