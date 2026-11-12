import type { LangWatchQLPass } from "@langwatch/analytics-contract";
/**
 * The route of a query decides which database its statement may name, and nothing runs before
 * that route is known: a private organization names its route's database, never the shared one;
 * a failing route runs no statement at all; one query asks the route once.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { PrivateRouteUnavailableError, UnknownTenantError } from "@langwatch/clickhouse-client";
import type { TenantRoute } from "@langwatch/clickhouse-client";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { ADMIT_EVERY_PLACEMENT, TEST_RUN_TELEMETRY } from "../../app/__tests__/analytics.fixture.ts";
import { RoutedLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-routed-executor.repository.ts";
import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { catalogueWithout, EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const SHARED: LangWatchQLConnection = {
  url: "http://shared.invalid:8123",
  username: "langwatch_lwql",
  password: "lwql-secret",
  database: "analytics",
  tenantSetting: "custom_lwql_key_hash",
};
const PRIVATE: TenantRoute = {
  kind: "private",
  organizationId: "org-private",
  url: "https://route-user:route-password@private.invalid:8443/acme_db",
};
const SHARED_ROUTE: TenantRoute = { kind: "shared" };
const WINDOW = { start: "2026-02-01T00:00:00.000Z", end: "2026-02-04T00:00:00.000Z" };
const PERIOD_SQL =
  "SELECT count() AS n FROM trace_metrics " +
  "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime} LIMIT 1";
const [POSTGRES_VIEW] = LangWatchQLCatalogShapesService.create().postgresViews(LWQL_VIEW_CATALOG);
if (!POSTGRES_VIEW) throw new Error("the catalogue has no PostgreSQL-resident view");
const PROTECTIONS = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};
const PROJECT = { id: "project-1", lwqlKey: "key-1" };
const countFrom = (table: string) => `SELECT count() AS n FROM ${table} LIMIT 1`;

class RecordingExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(
    readonly connection: LangWatchQLConnection,
    readonly target: string,
  ) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);

    return Promise.resolve({
      columns: [{ name: "n", type: "UInt64" }],
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    });
  }
}

/** What each successive ask of the route answers; the last answer repeats. An Error rejects. */
type RouteAnswers = readonly (TenantRoute | Error)[];

function run({
  answers,
  sql,
  timeWindow,
  memberWindows,
  pass,
}: {
  answers: RouteAnswers;
  sql: string;
  timeWindow?: typeof WINDOW;
  /** Makes the run an aggregate's, scoped by window when any member opens after the start. */
  memberWindows?: readonly { projectId: string; from: number }[];
  /** Runs the statement as this pass instead of as a query. */
  pass?: LangWatchQLPass;
}) {
  const executors: RecordingExecutor[] = [];
  let routeCalls = 0;
  const routed = RoutedLangWatchQLExecutorRepository.create({
    connection: SHARED,
    route: () => {
      const answer = answers[Math.min(routeCalls, answers.length - 1)]!;
      routeCalls += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    createExecutor: ({ connection, target }) => {
      const executor = new RecordingExecutor(connection, target);
      executors.push(executor);
      return executor;
    },
  });
  const service = LangWatchQLService.create({
    runTelemetry: TEST_RUN_TELEMETRY,
    placement: ADMIT_EVERY_PLACEMENT,
    executor: routed,
    database: SHARED.database,
  });
  const done = pass
    ? service.executePass({
        project: PROJECT,
        protections: PROTECTIONS,
        sql,
        pass,
        isInstantEvalsEnabled: true,
      })
    : service.executeForProjects({
        projects: [PROJECT],
        protections: PROTECTIONS,
        sql,
        ...(timeWindow ? { timeWindow } : {}),
        ...(memberWindows ? { memberWindows } : {}),
      });

  return {
    service,
    done,
    routeCalls: () => routeCalls,
    /** Every statement any server was handed. */
    requests: () => executors.flatMap((executor) => executor.requests),
    onTarget: (target: string) =>
      executors.filter((executor) => executor.target === target).flatMap((e) => e.requests),
    databasesDialled: () =>
      new Set(
        executors
          .filter((executor) => executor.requests.length > 0)
          .map((executor) => executor.connection.database),
      ),
  };
}

/** How the run ended: `ok`, or the handled error's code and the violations it carried. */
async function outcomeOf(done: Promise<unknown>) {
  try {
    await done;
    return { code: "ok", violations: [] as string[] };
  } catch (error) {
    if (!HandledError.isHandled(error)) throw error;
    const { violations = [] } = error.meta as { violations?: readonly { code: string }[] };

    return { code: error.code, violations: violations.map((violation) => violation.code) };
  }
}

/** Every `database.` that precedes a table name in the SQL a server was handed. */
function qualifiersOf(requests: readonly LangWatchQLExecutionRequest[]): string[] {
  return requests.flatMap(({ sql }) =>
    [...sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)\.\w+/gi)].map((match) => match[1]!),
  );
}

describe("given a private organization whose route database is acme_db and a shared database analytics", () => {
  /** @scenario "A LangWatchQL query for an organization with a private ClickHouse runs on that ClickHouse as the LangWatchQL identity" */
  it("refuses a statement naming the shared database, and runs nothing", async () => {
    const attempt = run({ answers: [PRIVATE], sql: countFrom("analytics.trace_metrics") });

    const refusal = await outcomeOf(attempt.done);
    expect(refusal.code).toBe("lwql_not_permitted");
    expect(refusal.violations).toContain("TABLE_NOT_ALLOWED");
    expect(attempt.requests()).toEqual([]);
  });

  /** @scenario "A statement on a private route names the route's database, never the shared one" */
  it("admits a statement naming the route database and runs it only there", async () => {
    const attempt = run({ answers: [PRIVATE], sql: countFrom("acme_db.trace_metrics") });

    expect((await outcomeOf(attempt.done)).code).toBe("ok");
    expect(new Set(qualifiersOf(attempt.requests()))).toEqual(new Set(["acme_db"]));
    expect(attempt.onTarget("shared")).toEqual([]);
  });

  it("leaves an unqualified name unqualified and runs it on the route database", async () => {
    const attempt = run({ answers: [PRIVATE], sql: countFrom("trace_metrics") });

    expect((await outcomeOf(attempt.done)).code).toBe("ok");
    expect(qualifiersOf(attempt.requests())).toEqual([]);
    expect(attempt.onTarget("private").length).toBeGreaterThan(0);
    expect(attempt.onTarget("shared")).toEqual([]);
    expect(attempt.databasesDialled()).toEqual(new Set(["acme_db"]));
  });
});

describe("given a shared organization", () => {
  it("admits an unqualified statement in a pass and runs it on the shared server", async () => {
    const attempt = run({
      answers: [SHARED_ROUTE],
      sql: "SELECT count() AS n FROM trace_metrics WHERE TraceId IN (SELECT TraceId FROM traces) LIMIT 1",
      pass: { kind: "probe" },
    });

    expect((await outcomeOf(attempt.done)).code).toBe("ok");
    expect(attempt.databasesDialled()).toEqual(new Set(["analytics"]));
  });

  /** @scenario "A statement on a private route names the route's database, never the shared one" */
  it("refuses a statement naming another organization's database, and runs nothing", async () => {
    const attempt = run({ answers: [SHARED_ROUTE], sql: countFrom("acme_db.trace_metrics") });

    const refusal = await outcomeOf(attempt.done);
    expect(refusal.code).toBe("lwql_not_permitted");
    expect(refusal.violations).toContain("TABLE_NOT_ALLOWED");
    expect(attempt.requests()).toEqual([]);
  });

  it("still admits a statement naming the shared database", async () => {
    const attempt = run({ answers: [SHARED_ROUTE], sql: countFrom("analytics.trace_metrics") });

    expect((await outcomeOf(attempt.done)).code).toBe("ok");
    expect(new Set(qualifiersOf(attempt.requests()))).toEqual(new Set(["analytics"]));
  });
});

describe("given a route that cannot be resolved", () => {
  // A route refusal is wrapped by the routed executor into the one unavailable refusal; any
  // other failure passes through untouched.
  const NOT_AVAILABLE = "LangWatchQL is not available for this organization's ClickHouse.";
  const failures: readonly [string, Error, string][] = [
    [
      "a private organization whose route is missing",
      new PrivateRouteUnavailableError({
        organizationId: "org-private",
        variable: "CLICKHOUSE_URL__acme__org-private",
        problem: "missing",
      }),
      NOT_AVAILABLE,
    ],
    [
      "a project with no known organization",
      new UnknownTenantError("project-1"),
      new UnknownTenantError("project-1").message,
    ],
  ];

  // Pinned: today the main query fails first, so the completeness read is never reached.
  it.each(failures)(
    "runs no statement at all for %s, completeness included",
    async (_, failure, expectedMessage) => {
      const attempt = run({ answers: [failure], sql: PERIOD_SQL, timeWindow: WINDOW });

      await expect(attempt.done).rejects.toThrow(expectedMessage);
      expect(attempt.requests()).toEqual([]);
    },
  );

  /** @scenario "A bad statement for an organization with no usable route gets the route refusal first" */
  it("refuses a bad statement as unavailable, not as a bad statement", async () => {
    const failure = failures[0]![1];
    const attempt = run({ answers: [failure], sql: "SELECT * FROM analytics.no_such_view" });

    expect((await outcomeOf(attempt.done)).code).toBe("lwql_unavailable");
    expect(attempt.requests()).toEqual([]);
  });
});

describe("given one query that reads the main result and then its completeness", () => {
  it("asks the route once", async () => {
    const attempt = run({ answers: [PRIVATE], sql: PERIOD_SQL, timeWindow: WINDOW });

    await attempt.done;

    // Two statements ran, so the completeness read did happen.
    expect(attempt.onTarget("private").length).toBeGreaterThan(1);
    expect(attempt.routeCalls()).toBe(1);
  });

  it("keeps every statement on the server the first answer named", async () => {
    const attempt = run({ answers: [PRIVATE, SHARED_ROUTE], sql: PERIOD_SQL, timeWindow: WINDOW });

    await attempt.done;

    expect(attempt.onTarget("shared")).toEqual([]);
    expect(attempt.databasesDialled()).toEqual(new Set(["acme_db"]));
  });
});

describe("given FINAL on a table qualified with the route's database", () => {
  const finalOn = `SELECT count() AS n FROM acme_db.${POSTGRES_VIEW.name} FINAL`;

  /** @scenario "A private route's statement may not use FINAL or SAMPLE on a PostgreSQL-resident view" */
  it("refuses it in a query, and runs nothing", async () => {
    const attempt = run({ answers: [PRIVATE], sql: finalOn });

    expect((await outcomeOf(attempt.done)).code).toBe("lwql_table_modifier_unsupported");
    expect(attempt.requests()).toEqual([]);
  });

  it("refuses it in a pass, and runs nothing", async () => {
    const attempt = run({ answers: [PRIVATE], sql: finalOn, pass: { kind: "count", limit: 10 } });

    expect((await outcomeOf(attempt.done)).code).toBe("lwql_table_modifier_unsupported");
    expect(attempt.requests()).toEqual([]);
  });
});

describe("given FINAL on a route-qualified table of a windowed aggregate", () => {
  const dated = [{ projectId: PROJECT.id, from: 1_000 }];

  // The windowed scope rewrites the table into a subquery, where FINAL means nothing.
  it("refuses it in a query on the route database, and runs nothing", async () => {
    const attempt = run({
      answers: [PRIVATE],
      sql: "SELECT count() AS n FROM acme_db.trace_metrics FINAL",
      timeWindow: WINDOW,
      memberWindows: dated,
    });

    expect((await outcomeOf(attempt.done)).code).toBe("lwql_table_modifier_unsupported");
    expect(attempt.requests()).toEqual([]);
  });
});

describe("given a pass for a private organization", () => {
  /** @scenario "A pass on a private route validates against the route's database and asks the route once" */
  it("admits an unqualified statement, as a shorthand writes it, and runs it on the route", async () => {
    const attempt = run({
      answers: [PRIVATE],
      sql: "SELECT count() AS n FROM trace_metrics WHERE TraceId IN (SELECT TraceId FROM traces) LIMIT 1",
      pass: { kind: "probe" },
    });

    expect((await outcomeOf(attempt.done)).code).toBe("ok");
    expect(attempt.databasesDialled()).toEqual(new Set(["acme_db"]));
    expect(attempt.onTarget("shared")).toEqual([]);
    expect(qualifiersOf(attempt.requests())).toEqual([]);
  });

  /** @scenario "A pass on a private route validates against the route's database and asks the route once" */
  it("runs a statement naming the route database, asking the route once", async () => {
    const attempt = run({
      answers: [PRIVATE],
      sql: countFrom("acme_db.trace_metrics"),
      pass: { kind: "probe" },
    });

    expect((await outcomeOf(attempt.done)).code).toBe("ok");
    expect(new Set(qualifiersOf(attempt.onTarget("private")))).toEqual(new Set(["acme_db"]));
    expect(attempt.onTarget("shared")).toEqual([]);
    expect(attempt.routeCalls()).toBe(1);
  });

  it("refuses a statement naming the shared database, and runs nothing", async () => {
    const attempt = run({
      answers: [PRIVATE],
      sql: countFrom("analytics.trace_metrics"),
      pass: { kind: "probe" },
    });

    const refusal = await outcomeOf(attempt.done);
    expect(refusal.code).toBe("lwql_not_permitted");
    expect(refusal.violations).toContain("TABLE_NOT_ALLOWED");
    expect(attempt.requests()).toEqual([]);
  });
});

describe("given a statement saved without a run", () => {
  const save = (sql: string) => {
    const attempt = run({ answers: [PRIVATE], sql: countFrom("trace_metrics") });
    const validate = () =>
      attempt.service.validate({ projectId: "project-1", protections: PROTECTIONS, sql });
    return { attempt, validate };
  };

  /** @scenario "A save needs no route" */
  it("admits a shared-database name and asks no route", async () => {
    const { attempt, validate } = save(countFrom("analytics.trace_metrics"));
    await attempt.done;
    const callsBefore = attempt.routeCalls();

    expect(validate).not.toThrow();
    expect(attempt.routeCalls()).toBe(callsBefore);
  });

  it("refuses a private-database name", async () => {
    const { attempt, validate } = save(countFrom("acme_db.trace_metrics"));
    await attempt.done;

    expect(validate).toThrow(expect.objectContaining({ code: "lwql_not_permitted" }));
  });
});

describe("given a deployment with no LangWatchQL identity", () => {
  const bare = LangWatchQLService.create({
    runTelemetry: TEST_RUN_TELEMETRY,
    placement: ADMIT_EVERY_PLACEMENT,
    executor: null,
    database: SHARED.database,
  });
  // A viewer: everything but cost, so a cost statement is a refusal the policy owns.
  const viewer = { ...PROTECTIONS, canSeeCosts: false, catalogue: catalogueWithout("cost:view") };
  const unreadable = "SELECT sum(TotalCost) AS cost FROM analytics.traces";
  const readable = countFrom("analytics.trace_metrics");
  const attempt = ({ sql, pass }: { sql: string; pass?: LangWatchQLPass }) =>
    pass
      ? bare.executePass({
          project: PROJECT,
          protections: viewer,
          sql,
          pass,
          isInstantEvalsEnabled: true,
        })
      : bare.executeForProjects({ projects: [PROJECT], protections: viewer, sql });

  /** @scenario "A deployment with no LangWatchQL identity judges the statement first" */
  it("refuses a statement the caller may not read with the policy's refusal, in a query", async () => {
    expect((await outcomeOf(attempt({ sql: unreadable }))).code).toBe("lwql_not_permitted");
  });

  /** @scenario "A deployment with no LangWatchQL identity judges the statement first" */
  it("refuses a statement the caller may not read with the policy's refusal, in a pass", async () => {
    const done = attempt({ sql: unreadable, pass: { kind: "probe" } });

    expect((await outcomeOf(done)).code).toBe("lwql_not_permitted");
  });

  /** @scenario "A deployment with no LangWatchQL identity judges the statement first" */
  it("refuses a statement the caller may read as unavailable, in a query", async () => {
    expect((await outcomeOf(attempt({ sql: readable }))).code).toBe("lwql_unavailable");
  });

  /** @scenario "A deployment with no LangWatchQL identity judges the statement first" */
  it("refuses a statement the caller may read as unavailable, in a pass", async () => {
    const done = attempt({ sql: readable, pass: { kind: "probe" } });

    expect((await outcomeOf(done)).code).toBe("lwql_unavailable");
  });
});

describe("given a run validated at its start", () => {
  const MISSING = new PrivateRouteUnavailableError({
    organizationId: "org-private",
    variable: "CLICKHOUSE_URL__acme__org-private",
    problem: "missing",
  });

  /** The service over a recording route, and the number of times the route was asked. */
  function validating(answer: TenantRoute | Error) {
    let routeCalls = 0;
    const executors: RecordingExecutor[] = [];
    const routed = RoutedLangWatchQLExecutorRepository.create({
      connection: SHARED,
      route: () => {
        routeCalls += 1;
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
      createExecutor: ({ connection, target }) => {
        const executor = new RecordingExecutor(connection, target);
        executors.push(executor);
        return executor;
      },
    });
    const service = LangWatchQLService.create({
      runTelemetry: TEST_RUN_TELEMETRY,
      placement: ADMIT_EVERY_PLACEMENT,
      executor: routed,
      database: SHARED.database,
    });

    return {
      routeCalls: () => routeCalls,
      ranAnything: () => executors.some((executor) => executor.requests.length > 0),
      validateRun: (sql: string) =>
        service.validateForRun({ projectId: PROJECT.id, protections: PROTECTIONS, sql }),
    };
  }

  /** @scenario "A run validates against its route's database before anything is judged" */
  it("refuses a statement naming the shared database on a private organization", async () => {
    const attempt = validating(PRIVATE);

    const refusal = await outcomeOf(attempt.validateRun(countFrom("analytics.traces")));

    expect(refusal.code).toBe("lwql_not_permitted");
    expect(refusal.violations).toContain("TABLE_NOT_ALLOWED");
    expect(attempt.ranAnything()).toBe(false);
  });

  /** @scenario "A run validates against its route's database before anything is judged" */
  it("accepts a statement naming the route database and asks the route once", async () => {
    const attempt = validating(PRIVATE);

    expect((await outcomeOf(attempt.validateRun(countFrom("acme_db.traces")))).code).toBe("ok");
    expect(attempt.routeCalls()).toBe(1);
    expect(attempt.ranAnything()).toBe(false);
  });

  /** @scenario "A run validates against its route's database before anything is judged" */
  it("gives a missing route its refusal, even for a statement the policy would refuse", async () => {
    const attempt = validating(MISSING);

    const refusal = await outcomeOf(attempt.validateRun("SELECT * FROM analytics.no_such_view"));

    expect(refusal.code).toBe("lwql_unavailable");
    expect(attempt.ranAnything()).toBe(false);
  });

  /** @scenario "A run validates against its route's database before anything is judged" */
  it("judges a shared organization against the shared database, as before", async () => {
    const attempt = validating(SHARED_ROUTE);

    expect((await outcomeOf(attempt.validateRun(countFrom("analytics.traces")))).code).toBe("ok");
    expect((await outcomeOf(attempt.validateRun(countFrom("acme_db.traces")))).code).toBe(
      "lwql_not_permitted",
    );
  });
});
