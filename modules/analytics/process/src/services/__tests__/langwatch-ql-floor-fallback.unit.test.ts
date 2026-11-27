/**
 * @vitest-environment node
 * A deployment whose floored twin is not provisioned yet (a rolling deploy) answers a floored read
 * as written, from the whole-history view, instead of refusing it.
 * @see specs/lwql/dedup-floor.feature
 * @see modules/analytics/adrs/005-evaluation-metrics-dedup-floor.md
 */
import {
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  ADMIT_EVERY_PLACEMENT,
  TEST_RUN_TELEMETRY,
} from "../../app/__tests__/analytics.fixture.ts";
import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const FLOORED_READ =
  "SELECT count() AS n FROM evaluation_metrics WHERE OccurredAt >= subtractDays(now(), 7) LIMIT 1";

/**
 * A ClickHouse that cannot serve the relation `missing`: a statement reading it is refused
 * unavailable (no such table) or, with `denied`, provisioning incomplete (no grant on it yet).
 */
class DeploymentWithout extends LangWatchQLExecutorRepository {
  readonly sent: string[] = [];
  private readonly missing: RegExp;
  private readonly denied: boolean;

  constructor({ missing, denied = false }: { missing: RegExp; denied?: boolean }) {
    super();
    this.missing = missing;
    this.denied = denied;
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.sent.push(request.sql);
    if (this.missing.test(request.sql)) {
      return Promise.reject(
        this.denied
          ? new LangWatchQLProvisioningIncompleteError()
          : new LangWatchQLUnavailableError(),
      );
    }
    return Promise.resolve({
      columns: [{ name: "n", type: "UInt64" }],
      rows: [{ n: "3" }],
      statistics: { elapsedMs: 1, rowsRead: 3, bytesRead: 0, rowsReturned: 1 },
    });
  }
}

async function run(executor: DeploymentWithout) {
  const service = LangWatchQLService.create({
    runTelemetry: TEST_RUN_TELEMETRY,
    placement: ADMIT_EVERY_PLACEMENT,
    executor,
    database: "analytics",
  });
  return service.executeForProjects({
    projects: [{ id: "project-1", lwqlKey: "key-1" }],
    protections: {
      catalogue: EVERY_CATALOGUE_PERMISSION,
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    },
    sql: FLOORED_READ,
  });
}

describe("given a deployment whose floored twin is not provisioned yet", () => {
  /** @scenario "A read the twin cannot answer yet is sent as written" */
  it("answers the read as written after the floored statement is refused", async () => {
    const executor = new DeploymentWithout({ missing: /evaluation_metrics__floor/ });

    const result = await run(executor);

    expect(result.rows).toEqual([{ n: "3" }]);
    expect(executor.sent).toHaveLength(2);
    expect(executor.sent[0]).toContain("evaluation_metrics__floor(");
    expect(executor.sent[1]).not.toContain("__floor");
  });
});

describe("given a deployment whose floored twin exists but whose grant has not landed yet", () => {
  /** @scenario "A read the twin's grant does not cover yet is sent as written" */
  it("answers the read as written after the twin is refused access", async () => {
    const executor = new DeploymentWithout({ missing: /evaluation_metrics__floor/, denied: true });

    const result = await run(executor);

    expect(result.rows).toEqual([{ n: "3" }]);
    expect(executor.sent).toHaveLength(2);
    expect(executor.sent[1]).not.toContain("__floor");
  });
});

describe("given a deployment that denies the view itself", () => {
  /** @scenario "A read the twin's grant does not cover yet is sent as written" */
  it("still refuses as provisioning incomplete", async () => {
    const executor = new DeploymentWithout({ missing: /evaluation_metrics/, denied: true });

    const refusal = await run(executor).catch((error: unknown) => error);

    expect((refusal as { code?: string }).code).toBe("lwql_provisioning_incomplete");
    expect(executor.sent).toHaveLength(2);
  });
});

describe("given a deployment missing the view itself", () => {
  /** @scenario "A read the twin cannot answer yet is sent as written" */
  it("still refuses as unavailable", async () => {
    const executor = new DeploymentWithout({ missing: /evaluation_metrics/ });

    const refusal = await run(executor).catch((error: unknown) => error);

    expect((refusal as { code?: string }).code).toBe("lwql_unavailable");
  });
});
