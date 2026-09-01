import { Counter, register } from "prom-client";
import { describe, expect, it } from "vitest";
import {
  ApiMetricsAbsenceReportPort,
  ApiMetricsInfrastructure,
} from "../api-metrics.infrastructure";

class RecordedAbsence extends ApiMetricsAbsenceReportPort {
  calls = 0;

  absent(): void {
    this.calls += 1;
  }
}

function scrape(authorization?: string): Request {
  return new Request("http://api.test/metrics", {
    headers: authorization ? { authorization } : {},
  });
}

describe("ApiMetricsInfrastructure", () => {
  describe("given a deployment that configured a credential", () => {
    /** @scenario "An authenticated scrape renders what this process recorded" */
    it("renders the registry this process's own packages record into", async () => {
      new Counter({
        name: "langwatch_api_process_owned_sample_total",
        help: "A sample recorded through the process-global registry.",
      }).inc(7);

      const infrastructure = ApiMetricsInfrastructure.tryCreate({
        key: "configured-key",
        nodeEnvironment: "production",
      });
      if (!infrastructure) throw new Error("A configured credential composed no metrics surface.");

      const response = await infrastructure.metrics.respond(scrape("Bearer configured-key"));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("langwatch_api_process_owned_sample_total 7");
    });

    it("also renders the default process collectors, so a scrape is never only bespoke counters", async () => {
      const infrastructure = ApiMetricsInfrastructure.tryCreate({
        key: "configured-key",
        nodeEnvironment: "production",
      });
      if (!infrastructure) throw new Error("A configured credential composed no metrics surface.");

      const body = await (
        await infrastructure.metrics.respond(scrape("Bearer configured-key"))
      ).text();

      expect(body).toContain("process_cpu_user_seconds_total");
      expect(body).toContain("nodejs_heap_size_used_bytes");
    });

    /** @scenario "A scrape with no credential or the wrong one is rejected" */
    it("gates the surface on that credential rather than composing it open", async () => {
      const infrastructure = ApiMetricsInfrastructure.tryCreate({
        key: "  configured-key  ",
        nodeEnvironment: "development",
      });
      if (!infrastructure) throw new Error("A configured credential composed no metrics surface.");

      expect(await infrastructure.metrics.respond(scrape())).toHaveProperty("status", 401);
      expect(await infrastructure.metrics.respond(scrape("Bearer configured-key"))).toHaveProperty(
        "status",
        200,
      );
    });
  });

  describe("given a production deployment that configured no credential", () => {
    /** @scenario "In production an unset key leaves the process with no metrics endpoint" */
    it("composes no surface at all and says so, rather than one open to everyone", () => {
      const report = new RecordedAbsence();

      const infrastructure = ApiMetricsInfrastructure.tryCreate({
        key: undefined,
        nodeEnvironment: "production",
        report,
      });

      expect(infrastructure).toBeUndefined();
      expect(report.calls).toBe(1);
    });

    /** @scenario "In production an unset key leaves the process with no metrics endpoint" */
    it("treats a variable exported blank as unconfigured, not as a credential", () => {
      const report = new RecordedAbsence();

      const infrastructure = ApiMetricsInfrastructure.tryCreate({
        key: "   \t \n ",
        nodeEnvironment: "production",
        report,
      });

      expect(infrastructure).toBeUndefined();
      expect(report.calls).toBe(1);
    });
  });

  describe("given a deployment outside production that configured no credential", () => {
    /** @scenario "Outside production an unset key leaves the endpoint open" */
    it("composes the surface open, as the web process has always allowed", async () => {
      const report = new RecordedAbsence();

      const infrastructure = ApiMetricsInfrastructure.tryCreate({
        key: undefined,
        nodeEnvironment: "development",
        report,
      });
      if (!infrastructure) throw new Error("A development process composed no metrics surface.");

      expect(await infrastructure.metrics.respond(scrape())).toHaveProperty("status", 200);
      expect(report.calls).toBe(0);
    });
  });

  describe("when one process composes the surface more than once", () => {
    /** @scenario "A registry that already carries default collectors is left intact" */
    it("leaves the collectors the registry already holds, rather than failing the boot", async () => {
      ApiMetricsInfrastructure.create({ access: { gate: "open" } });

      const second = ApiMetricsInfrastructure.create({ access: { gate: "open" } });

      const body = await (await second.metrics.respond(scrape())).text();
      expect(body).toContain("process_cpu_user_seconds_total");
      expect(register.getSingleMetric("process_cpu_user_seconds_total")).toBeDefined();
    });
  });
});
