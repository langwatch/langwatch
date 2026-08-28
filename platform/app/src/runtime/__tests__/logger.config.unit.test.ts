import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveLegacyLoggerConfiguration } from "../logger.config";

describe("resolveLegacyLoggerConfiguration", () => {
  it("preserves legacy logger precedence and OTel identity", () => {
    expect(
      resolveLegacyLoggerConfiguration({
        NODE_ENV: "production",
        LOG_FORMAT: "pretty",
        PINO_LOG_LEVEL: "warn",
        _LOG_LEVEL: "error",
        PINO_OTEL_ENABLED: "true",
        LOG_CONSOLE_LEVEL: "error",
        PINO_CONSOLE_LEVEL: "info",
        LOG_OTEL_LEVEL: "info",
        PINO_OTEL_LEVEL: "debug",
        OTEL_SERVICE_NAME: "langwatch-api",
        SERVICE_VERSION: " explicit-build ",
        OTEL_RESOURCE_ATTRIBUTES: "service.version=ignored",
        ENVIRONMENT: "prod-eu",
        npm_package_version: "1.10.0",
      }),
    ).toEqual({
      environment: "production",
      format: "pretty",
      level: "warn",
      otelExportEnabled: true,
      consoleLevel: "error",
      otelLevel: "info",
      serviceName: "langwatch-api",
      serviceVersion: "explicit-build",
      deploymentEnvironment: "prod-eu",
      otelTransportServiceVersion: "1.10.0",
    });
  });

  it("falls back to legacy levels and the decoded OTel resource version", () => {
    expect(
      resolveLegacyLoggerConfiguration({
        NODE_ENV: "development",
        LOG_FORMAT: "not-a-format",
        _LOG_LEVEL: "debug",
        PINO_OTEL_ENABLED: "false",
        PINO_CONSOLE_LEVEL: "warn",
        PINO_OTEL_LEVEL: "error",
        OTEL_RESOURCE_ATTRIBUTES: "service.name=langwatch,service.version=git%2Dabc%2C1",
      }),
    ).toMatchObject({
      environment: "development",
      format: undefined,
      level: "debug",
      otelExportEnabled: false,
      consoleLevel: "warn",
      otelLevel: "error",
      serviceVersion: "git-abc,1",
    });
  });

  it("continues past blank resource versions", () => {
    expect(
      resolveLegacyLoggerConfiguration({
        OTEL_RESOURCE_ATTRIBUTES: "service.version=,service.version=git%2Dnext",
      }).serviceVersion,
    ).toBe("git-next");
  });

  it("keeps malformed resource escaping as the legacy parser did", () => {
    expect(
      resolveLegacyLoggerConfiguration({
        OTEL_RESOURCE_ATTRIBUTES: "service.version=100%off,service.version=git-next",
      }).serviceVersion,
    ).toBe("100%off");
  });

  describe("legacy service.version resource parity", () => {
    const serviceVersion = (resourceAttributes: string): string | undefined =>
      resolveLegacyLoggerConfiguration({ OTEL_RESOURCE_ATTRIBUTES: resourceAttributes })
        .serviceVersion;

    it("ignores similarly named keys", () => {
      expect(serviceVersion("app.version=1.2.3,service.version=git-abc")).toBe("git-abc");
    });

    it("accepts whitespace around the service.version pair", () => {
      expect(serviceVersion("service.name=langwatch, service.version = git-spaced ")).toBe(
        "git-spaced",
      );
    });

    it("keeps equals signs in the version value", () => {
      expect(serviceVersion("service.version=a=b")).toBe("a=b");
    });

    it("uses the explicit service version before resource attributes", () => {
      expect(
        resolveLegacyLoggerConfiguration({
          SERVICE_VERSION: "explicit",
          OTEL_RESOURCE_ATTRIBUTES: "service.version=from-attrs",
        }).serviceVersion,
      ).toBe("explicit");
    });

    it("omits the version when every matching resource value is empty", () => {
      expect(serviceVersion("service.version=,service.version=")).toBeUndefined();
    });

    it("omits the version when resource attributes do not declare it", () => {
      expect(serviceVersion("service.name=langwatch")).toBeUndefined();
    });
  });
});

describe("legacy executable logger bootstrap order", () => {
  it.each([
    [
      "../../server.mts",
      ["./runtime/executable-bootstrap.config", "@langwatch/observability"],
      ["./runtime/app/boot", "./instrumentation.node"],
    ],
    [
      "../../workers.ts",
      ["./runtime/executable-bootstrap.config", "@langwatch/observability"],
      [
        "./instrumentation.node",
        "./server/handled-error-wiring",
        "@langwatch/worker",
        "./runtime/worker/legacy-worker.executable.adapter",
      ],
    ],
    [
      "../../instrumentation.ts",
      ["./runtime/executable-bootstrap.config", "@langwatch/observability"],
      ["./instrumentation.node", "./server/app-layer/presets"],
    ],
    [
      "../../../scripts/dogfood/governance/seed-demo.ts",
      ["../../../src/runtime/logger.config", "@langwatch/observability"],
      ["./seed-demo.runner"],
    ],
  ])(
    "configures logger before %s imports graph modules",
    async (entry, configImports, graphImports) => {
      const source = await readEntry(entry);
      const configuredAt = source.indexOf(
        source.includes("configureLogger(bootstrap.logger)")
          ? "configureLogger(bootstrap.logger)"
          : "configureLogger(resolveLegacyLoggerConfiguration(process.env))",
      );

      expect(configuredAt).toBeGreaterThan(-1);
      for (const specifier of configImports) {
        expect(source.indexOf(specifier)).toBeLessThan(configuredAt);
      }
      for (const specifier of graphImports) {
        expect(source.indexOf(specifier)).toBeGreaterThan(configuredAt);
      }
    },
  );

  // `task.ts` no longer configures the logger itself, so it cannot carry an
  // ordering row: the physical executable owns that and configures logging
  // before it calls the injected executor. What the ordering row used to buy
  // is now bought by the executor keeping the graph lazy — it is constructed
  // in `task.ts` BEFORE the executable runs, so a module-scope import here
  // would load the application graph before any logger exists.
  describe("when the legacy task executor is constructed ahead of the executable", () => {
    it("keeps every application graph module behind a call-time import", async () => {
      const source = await readEntry("../task/legacy-platform-task.executor.ts");
      const moduleScope = source.slice(0, source.indexOf("export class"));

      for (const specifier of [
        "~/server/app-layer/app",
        "~/server/app-layer/presets",
        "~/tasks.generated",
      ]) {
        expect(moduleScope).not.toContain(specifier);
        expect(source).toContain(`await import("${specifier}")`);
      }
    });
  });
});

async function readEntry(relativePath: string): Promise<string> {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return await readFile(path, "utf8");
}
