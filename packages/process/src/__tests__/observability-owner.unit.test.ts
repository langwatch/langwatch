// @vitest-environment node
import { ConfigLeaf, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { observabilityOwner } from "../observability-owner.ts";

const parse = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [observabilityOwner], environment }).observability;

describe("the observability owner's declaration", () => {
  describe("given no metrics mode in the environment", () => {
    /** @scenario "No metrics mode is configured" */
    it("pushes over OTLP, which is cheaper than a scrape at our cardinality", () => {
      expect(parse({}).metrics.mode).toBe("otlp");
    });
  });

  describe("given a deployment that asks for a scrape", () => {
    /** @scenario "A deployment asks for a Prometheus scrape instead" */
    it("reads the mode by the word the operator wrote", () => {
      expect(parse({ LANGWATCH_METRICS_MODE: "prometheus" }).metrics.mode).toBe("prometheus");
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

  it("switches metrics off only on the explicit word", () => {
    expect(parse({}).metrics.enabled).toBe(true);
    expect(parse({ OTEL_METRICS_ENABLED: "false" }).metrics.enabled).toBe(false);
  });
});

function configEnvNames(slice: object): string[] {
  return Object.values(slice).flatMap((node) =>
    node instanceof ConfigLeaf ? [node.env] : configEnvNames(node),
  );
}
