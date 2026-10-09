// @vitest-environment node
import {
  ConfigLeaf,
  otelResourceAttributes,
  parseProcessConfig,
  serviceVersion,
} from "@langwatch/config";
import { resolveTelemetry, TelemetryAliasConflictError } from "@langwatch/observability/node";
import { describe, expect, it } from "vitest";

import { observabilityOwner } from "../observability-owner.ts";

const parse = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [observabilityOwner], environment }).observability;
const resolve = (environment: Record<string, string | undefined>) =>
  resolveTelemetry(parse(environment));
const collector = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" };

describe("the observability owner's declaration", () => {
  describe("given a Grafana in the environment", () => {
    /** @scenario "Every process role reads the Grafana settings from its observability config" */
    it("carries its base URL and datasource uid, and nothing when the base is blank", () => {
      const grafana = parse({
        GRAFANA_BASE_URL: "https://grafana.example.com",
        GRAFANA_TEMPO_DATASOURCE_UID: "tempo-prod",
      }).grafana;
      expect(grafana.baseUrl).toBe("https://grafana.example.com");
      expect(grafana.tempoDatasourceUid).toBe("tempo-prod");
      expect(parse({ GRAFANA_BASE_URL: "" }).grafana.baseUrl).toBeUndefined();
    });
  });

  describe("given no metrics mode in the environment", () => {
    /** @scenario "No metrics mode is configured" */
    it("pushes over OTLP, which is cheaper than a scrape at our cardinality", () => {
      expect(resolve({}).metrics.mode).toBe("otlp");
    });
  });

  describe("given a deployment that asks for a scrape", () => {
    /** @scenario "A deployment asks for a Prometheus scrape instead" */
    it("reads the standard exporter list", () => {
      expect(resolve({ OTEL_METRICS_EXPORTER: "otlp,prometheus" }).metrics.mode).toBe("prometheus");
    });
  });

  describe("given the collector's credential", () => {
    /** @scenario "The OTLP auth headers are declared as a handle" */
    it("declares it as a secret handle and never as a config leaf", () => {
      const ids = Object.values(observabilityOwner.secrets).map((handle) => handle.id);
      expect(ids).toContain("OTEL_EXPORTER_OTLP_HEADERS");
      expect(configEnvNames(observabilityOwner.config)).not.toContain("OTEL_EXPORTER_OTLP_HEADERS");
    });
  });

  it("refuses a sampling ratio outside [0, 1] by name", () => {
    expect(() => parse({ OTEL_TRACES_SAMPLER_ARG: "7" })).toThrowError(
      /observability\.tracesSampleRatio ← OTEL_TRACES_SAMPLER_ARG/,
    );
  });

  describe("given the OTLP endpoint is declared but blank", () => {
    /** @scenario "An optional field is left blank in the environment" */
    it("treats it as unconfigured instead of refusing the parse", () => {
      expect(parse({ OTEL_EXPORTER_OTLP_ENDPOINT: "" }).otlpEndpoint).toBeUndefined();
    });
  });

  describe("given a module holding the shared release leaves beside observability", () => {
    /** @scenario "Observability and a module both holding the release leaves parse them" */
    it("parses SERVICE_VERSION and OTEL_RESOURCE_ATTRIBUTES once for both, with no collision", () => {
      const licensing = {
        name: "licensing",
        config: { serviceVersion, otelResourceAttributes },
      } as const;

      const config = parseProcessConfig({
        owners: [observabilityOwner, licensing],
        environment: {
          SERVICE_VERSION: "3.17.0",
          OTEL_RESOURCE_ATTRIBUTES: "service.name=langwatch",
        },
      });

      expect(config.observability.serviceVersion).toBe("3.17.0");
      expect(config.observability.resourceAttributes).toBe("service.name=langwatch");
      expect(config.licensing).toEqual({
        serviceVersion: "3.17.0",
        otelResourceAttributes: "service.name=langwatch",
      });
    });
  });

  it("switches metrics off only on the explicit word", () => {
    expect(resolve({}).metrics.enabled).toBe(true);
    expect(resolve({ OTEL_METRICS_EXPORTER: "none" }).metrics.enabled).toBe(false);
  });

  describe("given nothing but a collector", () => {
    it("exports traces, logs and metrics there, every log sink at LOG_LEVEL", () => {
      const resolved = resolve({ ...collector, LOG_LEVEL: "warn" });
      expect(resolved.tracesEndpoint).toBe("http://collector:4318");
      expect(resolved.metrics.endpoint).toBe("http://collector:4318");
      expect(resolved.logs).toEqual({
        level: "warn",
        consoleLevel: "warn",
        otelLevel: "warn",
        otelExport: true,
      });
      expect(resolved.deprecations).toEqual([]);
    });

    it("exports nothing without a collector, and nothing once the SDK is disabled", () => {
      for (const resolved of [resolve({}), resolve({ ...collector, OTEL_SDK_DISABLED: "true" })]) {
        expect(resolved.tracesEndpoint).toBeUndefined();
        expect(resolved.logs.otelExport).toBe(false);
        expect(resolved.metrics.endpoint).toBeUndefined();
      }
      expect(resolve({}).logs.otelLevel).toBe("info");
    });

    it("turns one signal off by its own exporter name", () => {
      const resolved = resolve({
        ...collector,
        OTEL_TRACES_EXPORTER: "none",
        OTEL_LOGS_EXPORTER: "none",
      });
      expect(resolved.tracesEndpoint).toBeUndefined();
      expect(resolved.logs.otelExport).toBe(false);
      expect(resolved.metrics.endpoint).toBe("http://collector:4318");
    });

    it("names the service by OTEL_SERVICE_NAME when it is set", () => {
      expect(resolve({ OTEL_SERVICE_NAME: "langwatch-app" }).serviceName).toBe("langwatch-app");
      expect(resolve({}).serviceName).toBeUndefined();
    });
  });

  describe("given main's older names", () => {
    it("reads each as its replacement and warns once per name", () => {
      const resolved = resolve({
        ...collector,
        PINO_LOG_LEVEL: "debug",
        PINO_CONSOLE_LEVEL: "error",
        PINO_OTEL_LEVEL: "info",
        PINO_OTEL_ENABLED: "false",
        OTEL_METRICS_ENABLED: "false",
      });
      expect(resolved.logs).toEqual({
        level: "debug",
        consoleLevel: "error",
        otelLevel: "info",
        otelExport: false,
      });
      expect(resolved.metrics.enabled).toBe(false);
      expect(resolved.deprecations).toHaveLength(5);
      expect(resolved.deprecations[0]).toMatch(/PINO_LOG_LEVEL is deprecated, use LOG_LEVEL/);
    });

    it("accepts an old name that agrees with its replacement", () => {
      const resolved = resolve({
        LOG_LEVEL: "warn",
        _LOG_LEVEL: "warn",
        PINO_OTEL_ENABLED: "true",
        OTEL_LOGS_EXPORTER: "otlp",
      });
      expect(resolved.logs.level).toBe("warn");
    });

    it("refuses the boot when an old name and its replacement disagree, naming both", () => {
      expect(() => resolve({ LOG_LEVEL: "info", PINO_LOG_LEVEL: "debug" })).toThrowError(
        TelemetryAliasConflictError,
      );
      expect(() =>
        resolve({ OTEL_METRICS_EXPORTER: "otlp", OTEL_METRICS_ENABLED: "false" }),
      ).toThrowError(
        /OTEL_METRICS_EXPORTER=otlp, OTEL_METRICS_ENABLED=none: set only OTEL_METRICS_EXPORTER/,
      );
    });

    it("declares a config leaf for every alias the table reads", () => {
      expect(configEnvNames(observabilityOwner.config)).toEqual(
        expect.arrayContaining([
          "PINO_LOG_LEVEL",
          "_LOG_LEVEL",
          "PINO_OTEL_ENABLED",
          "OTEL_METRICS_ENABLED",
        ]),
      );
      expect(configEnvNames(observabilityOwner.config)).not.toContain("LANGWATCH_METRICS_MODE");
    });
  });
});

function configEnvNames(slice: object): string[] {
  return Object.values(slice).flatMap((node) =>
    node instanceof ConfigLeaf ? [node.env] : configEnvNames(node),
  );
}
