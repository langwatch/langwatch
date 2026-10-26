/**
 * Spec: specs/tooling/lint-metric-instrument-home.feature. Record: ARCHITECTURE.md §17.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { lintMetricInstrumentHome } from "../metric-instrument-home.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-metric-home-"));
  write("pnpm-workspace.yaml", 'packages:\n  - "modules/*/*"\n  - "packages/*"\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function lint() {
  return lintMetricInstrumentHome(buildWorkspaceSnapshot({ root, changedFiles: [] }));
}

function found(): string[] {
  return lint().map((violation) => `${violation.file}:${violation.line} ${violation.specifier}`);
}

const SERVICE = "modules/demo/process/src/services/ingest.service.ts";

describe("lintMetricInstrumentHome", () => {
  describe("when a module service not named for metrics creates instruments", () => {
    /** @scenario "An instrument created in a module file not named for metrics is reported" */
    it("reports each call at its line", () => {
      write(
        SERVICE,
        `import { counter, histogram as timing } from "@langwatch/observability/metrics";

export class IngestService {
  private readonly accepted = counter({ name: "langwatch_demo_accepted_total" });
  constructor() {
    this.duration = timing({ name: "langwatch_demo_duration_seconds" });
  }
}
`,
      );

      expect(found()).toEqual([`${SERVICE}:4 counter`, `${SERVICE}:6 histogram`]);
    });
  });

  describe("when the instrument is reached through a namespace import or a meter", () => {
    /** @scenario "An instrument reached through a namespace import or a meter is reported" */
    it("reports both calls", () => {
      const repository = "enterprise/modules/demo/process/src/repositories/demo.repository.ts";
      write(
        repository,
        `import * as metrics from "@langwatch/observability";
import { metrics as otel } from "@opentelemetry/api";

export class DemoRepository {
  private readonly writes = metrics.counter({ name: "langwatch_demo_writes_total" });
  private readonly latency = otel.getMeter("demo").createHistogram("langwatch_demo_latency_seconds");
}
`,
      );

      expect(found()).toEqual([`${repository}:5 counter`, `${repository}:6 createHistogram`]);
    });
  });

  describe("when the instrument is in the module's metrics service", () => {
    /** @scenario "An instrument in the module's metrics service is accepted" */
    it("reports nothing", () => {
      write(
        "modules/demo/process/src/services/ingest-metrics.service.ts",
        `import { counter } from "@langwatch/observability/metrics";
import { metrics } from "@opentelemetry/api";

export class IngestMetricsService {
  readonly accepted = counter({ name: "langwatch_demo_accepted_total" });
  readonly latency = metrics.getMeter("demo").createHistogram("langwatch_demo_latency_seconds");
}
`,
      );

      expect(found()).toEqual([]);
    });
  });

  describe("when the call is not a metrics factory, or is in a test or a package", () => {
    /** @scenario "A call that is not a metrics factory, a test and a package are left alone" */
    it("reports nothing", () => {
      write(
        SERVICE,
        `import { createLogger } from "@langwatch/observability";

const counter = (start: number) => () => start + 1;
export const next = counter(0);
export const logger = createLogger("demo");
`,
      );
      const creates = `import { counter } from "@langwatch/observability/metrics";
export const accepted = () => counter({ name: "langwatch_demo_accepted_total" });
`;
      write("modules/demo/process/src/services/__tests__/ingest.unit.test.ts", creates);
      write("modules/demo/process/src/services/ingest.test.ts", creates);
      write("packages/queue/src/queue.service.ts", creates);

      expect(found()).toEqual([]);
    });
  });

  describe("when a finding is read", () => {
    /** @scenario "Every finding says where the instrument belongs" */
    it("names the module's metrics service and the shrink-only list", () => {
      write(
        SERVICE,
        `import { counter } from "@langwatch/observability/metrics";
export class IngestService {
  private readonly accepted = counter({ name: "langwatch_demo_accepted_total" });
}
`,
      );
      const [violation] = lint();

      expect(violation?.policy).toBe("metric-instrument-home");
      expect(violation?.allowed).toContain("-metrics.service.ts");
      expect(violation?.allowed).toContain("tests/baselines/metric-instrument-home.json");
    });
  });
});
