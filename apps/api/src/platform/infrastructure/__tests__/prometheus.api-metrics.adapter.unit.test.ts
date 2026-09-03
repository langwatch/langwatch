import { Counter, Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { PrometheusApiMetricsAdapter } from "../prometheus.api-metrics.adapter";

const KEY = "metrics-bearer-key";

function registryHolding(sample: string): Registry {
  const registry = new Registry();
  new Counter({ name: sample, help: "A sample this process recorded.", registers: [registry] }).inc(
    3,
  );
  return registry;
}

function scrape(authorization?: string): Request {
  return new Request("http://api.test/metrics", {
    headers: authorization ? { authorization } : {},
  });
}

describe("PrometheusApiMetricsAdapter", () => {
  describe("given a deployment that configured a bearer credential", () => {
    /** @scenario "An authenticated scrape renders what this process recorded" */
    it("renders the registry it was given to a caller presenting that credential", async () => {
      const adapter = PrometheusApiMetricsAdapter.create({
        registry: registryHolding("langwatch_api_scrape_sample_total"),
        access: { gate: "bearer", key: KEY },
      });

      const response = await adapter.respond(scrape(`Bearer ${KEY}`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(await response.text()).toContain("langwatch_api_scrape_sample_total 3");
    });

    /** @scenario "A scrape with no credential or the wrong one is rejected" */
    it("refuses a caller with no credential, and tells it nothing about the process", async () => {
      const adapter = PrometheusApiMetricsAdapter.create({
        registry: registryHolding("langwatch_api_unauthenticated_sample_total"),
        access: { gate: "bearer", key: KEY },
      });

      const response = await adapter.respond(scrape());

      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
    });

    /** @scenario "A scrape with no credential or the wrong one is rejected" */
    it("refuses a caller presenting a different credential", async () => {
      const adapter = PrometheusApiMetricsAdapter.create({
        registry: registryHolding("langwatch_api_wrong_credential_sample_total"),
        access: { gate: "bearer", key: KEY },
      });

      const responses = await Promise.all([
        adapter.respond(scrape(`Bearer ${KEY}-nearly`)),
        adapter.respond(scrape(KEY)),
        adapter.respond(scrape(`Basic ${KEY}`)),
        adapter.respond(scrape("Bearer ")),
      ]);

      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
      for (const response of responses) {
        expect(await response.text()).toBe("");
      }
    });
  });

  describe("given a deployment that composed the surface open", () => {
    /** @scenario "Outside production an unset key leaves the endpoint open" */
    it("renders the registry to a caller carrying no credential at all", async () => {
      const adapter = PrometheusApiMetricsAdapter.create({
        registry: registryHolding("langwatch_api_open_sample_total"),
        access: { gate: "open" },
      });

      const response = await adapter.respond(scrape());

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("langwatch_api_open_sample_total 3");
    });
  });

  describe("given a registry that cannot render", () => {
    it("lets the failure reach the process rather than answering a scraper with an empty body", async () => {
      const adapter = PrometheusApiMetricsAdapter.create({
        registry: {
          contentType: "text/plain; version=0.0.4; charset=utf-8",
          metrics: () => Promise.reject(new Error("collector failed")),
        },
        access: { gate: "open" },
      });

      await expect(adapter.respond(scrape())).rejects.toThrow("collector failed");
    });
  });
});
