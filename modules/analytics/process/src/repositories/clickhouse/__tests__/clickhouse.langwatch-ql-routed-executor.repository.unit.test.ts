/**
 * Which ClickHouse a LangWatchQL statement runs on, and as whom. The executors are the real ones
 * over a recorded driver, so the claim covers what the driver is handed.
 * @see specs/lwql/api.feature
 */
import {
  PrivateRouteUnavailableError,
  type TenantRoute,
  TenantScopeError,
} from "@langwatch/clickhouse-client";
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LangWatchQLConnection } from "../../langwatch-ql-executor.repository.ts";
import { ClickHouseLangWatchQLExecutorRepository } from "../clickhouse.langwatch-ql-executor.repository.ts";
import { RoutedLangWatchQLExecutorRepository } from "../clickhouse.langwatch-ql-routed-executor.repository.ts";

type DriverConfig = Readonly<Record<string, unknown>>;
type Driver = {
  config: DriverConfig;
  query: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const { drivers } = vi.hoisted(() => ({ drivers: [] as Driver[] }));

vi.mock("@clickhouse/client", () => ({
  createClient: (config: DriverConfig) => {
    const driver: Driver = {
      config,
      query: vi.fn(async () => ({
        json: async () => ({ data: [{ n: 1 }], meta: [], statistics: { elapsed: 0 } }),
      })),
      close: vi.fn(async () => undefined),
    };
    drivers.push(driver);
    return driver;
  },
}));

const SHARED: LangWatchQLConnection = {
  url: "http://shared.invalid:8123",
  username: "langwatch_lwql",
  password: "lwql-secret",
  database: "langwatch",
  tenantSetting: "custom_lwql_key_hash",
};

const PRIVATE_ROUTE: TenantRoute = {
  kind: "private",
  organizationId: "org-private",
  url: "https://route-user:route-password@private.invalid:8443/acme_db",
};

const privateRoute = (): TenantRoute => PRIVATE_ROUTE;

/** Each project's route; one function per organization, so a set of two is two organizations. */
const ROUTES: Readonly<Record<string, () => TenantRoute>> = {
  "project-shared": () => ({ kind: "shared" }),
  "project-private": privateRoute,
  "project-private-2": privateRoute,
  "project-second-private": () => ({
    kind: "private",
    organizationId: "org-second",
    url: "http://route-user:route-password@second.invalid:8123/second_db",
  }),
  "project-no-database": () => ({
    kind: "private",
    organizationId: "org-no-database",
    url: "http://route-user:route-password@nodb.invalid:8123",
  }),
  "project-labelled": () => {
    throw new PrivateRouteUnavailableError({
      organizationId: "org-labelled",
      variable: "CLICKHOUSE_URL__globex__org-labelled",
      problem: "missing",
    });
  },
};

/** Routes as the service does, then runs on the executor the route names. */
const runOn = ({
  executor,
  tenantIds,
}: {
  executor: RoutedLangWatchQLExecutorRepository;
  tenantIds: readonly string[];
}) =>
  executor
    .resolveRoute({ tenantIds })
    .then((route) => route.executor.execute({ sql: "SELECT 1", tenantCapability: "capability" }));

function routeOf({ tenantIds }: { tenantIds: readonly string[] }): Promise<TenantRoute> {
  const routes = new Set(tenantIds.map((tenantId) => ROUTES[tenantId]));
  if (routes.size !== 1) {
    return Promise.reject(
      new TenantScopeError(
        { kind: "tenant-set-spans-organizations", organizations: [] },
        tenantIds[0] ?? "",
      ),
    );
  }
  return Promise.resolve().then(() => [...routes][0]!());
}

function fixture() {
  const createExecutor = vi.fn(
    (input: Parameters<typeof ClickHouseLangWatchQLExecutorRepository.create>[0]) =>
      ClickHouseLangWatchQLExecutorRepository.create(input),
  );
  const executor = RoutedLangWatchQLExecutorRepository.create({
    connection: SHARED,
    route: routeOf,
    createExecutor,
  });
  const [shared] = drivers;
  const run = (tenantIds: readonly string[]) => runOn({ executor, tenantIds });
  return { executor, createExecutor, shared: shared!, run };
}

const privateDrivers = () => drivers.filter((driver) => driver.config.url !== SHARED.url);

beforeEach(() => {
  drivers.length = 0;
});

describe("given a statement over projects on the shared ClickHouse", () => {
  it("runs on the shared executor, as before", async () => {
    const { shared, run } = fixture();

    await run(["project-shared"]);

    expect(shared.config).toMatchObject({
      url: SHARED.url,
      username: SHARED.username,
      password: SHARED.password,
      database: SHARED.database,
    });
    expect(shared.query).toHaveBeenCalledTimes(1);
    expect(privateDrivers()).toEqual([]);
  });
});

describe("given a statement over no projects", () => {
  it("runs on the shared executor and never asks for a route", async () => {
    const route = vi.fn(routeOf);
    const executor = RoutedLangWatchQLExecutorRepository.create({
      connection: SHARED,
      route,
      createExecutor: (input) => ClickHouseLangWatchQLExecutorRepository.create(input),
    });
    const [shared] = drivers;

    await runOn({ executor, tenantIds: [] });

    expect(shared?.query).toHaveBeenCalledTimes(1);
    expect(route).not.toHaveBeenCalled();
    expect(privateDrivers()).toEqual([]);
  });
});

describe("given a statement over an organization with a private ClickHouse", () => {
  /** @scenario "A LangWatchQL query for an organization with a private ClickHouse runs on that ClickHouse as the LangWatchQL identity" */
  it("runs on the route's origin and database as the LangWatchQL identity, with no route credentials anywhere", async () => {
    const { shared, run } = fixture();

    await run(["project-private"]);

    const [isolated] = privateDrivers();
    expect(isolated?.config).toMatchObject({
      url: "https://private.invalid:8443",
      username: SHARED.username,
      password: SHARED.password,
      database: "acme_db",
    });
    expect(JSON.stringify(drivers.map((driver) => driver.config))).not.toMatch(
      /route-user|route-password/,
    );
    expect(isolated?.query).toHaveBeenCalledWith(
      expect.objectContaining({ clickhouse_settings: { custom_lwql_key_hash: "capability" } }),
    );
    expect(shared.query).not.toHaveBeenCalled();
  });

  /** @scenario "A private route whose database is not a plain ClickHouse name is refused" */
  it("refuses a route that names no database, never adopting the shared one", async () => {
    const { shared, run } = fixture();

    const refusal = (await run(["project-no-database"]).catch(
      (error: unknown) => error,
    )) as HandledError;

    expect(refusal).toMatchObject({ code: "lwql_unavailable" });
    expect(refusal.reasons.map((r) => r.message)).toEqual(["no database"]);
    expect(shared.query).not.toHaveBeenCalled();
    expect(privateDrivers()).toEqual([]);
  });

  it("builds one executor per organization and reuses it", async () => {
    const { createExecutor, run } = fixture();

    await run(["project-private"]);
    await run(["project-private", "project-private-2"]);

    expect(createExecutor).toHaveBeenCalledTimes(2);
    expect(createExecutor.mock.calls.map(([input]) => input.target)).toEqual(["shared", "private"]);
    expect(privateDrivers()).toHaveLength(1);
    expect(privateDrivers()[0]?.query).toHaveBeenCalledTimes(2);
  });
});

describe("given more private organizations than the executor keeps open", () => {
  it("closes the least recently used private executor and keeps the rest", async () => {
    const executor = RoutedLangWatchQLExecutorRepository.create({
      connection: SHARED,
      route: routeOf,
      createExecutor: (input) => ClickHouseLangWatchQLExecutorRepository.create(input),
      maxPrivateExecutors: 1,
    });
    const run = (tenantIds: readonly string[]) => runOn({ executor, tenantIds });

    await run(["project-private"]);
    await run(["project-second-private"]);

    const [, first, second] = drivers;
    expect(first?.close).toHaveBeenCalledTimes(1);
    expect(second?.close).not.toHaveBeenCalled();

    await executor.close();
    expect(second?.close).toHaveBeenCalledTimes(1);
    expect(first?.close).toHaveBeenCalledTimes(1);
  });
});

describe("given an organization recorded as private whose route is missing", () => {
  /** @scenario "A LangWatchQL query for an organization whose private route is missing is refused, never answered from the shared ClickHouse" */
  it("refuses with lwql_unavailable and runs nothing on the shared ClickHouse", async () => {
    const { shared, run } = fixture();

    await expect(run(["project-labelled"])).rejects.toMatchObject({
      code: "lwql_unavailable",
      message: "LangWatchQL is not available for this organization's ClickHouse.",
    });
    expect(shared.query).not.toHaveBeenCalled();
    expect(privateDrivers()).toEqual([]);
  });
});

describe("given a statement over projects of two organizations", () => {
  /** @scenario "A LangWatchQL query spanning organizations is refused" */
  it("refuses with lwql_unavailable before any statement runs", async () => {
    const { shared, run } = fixture();

    await expect(run(["project-private", "project-shared"])).rejects.toMatchObject({
      code: "lwql_unavailable",
      message: "LangWatchQL is not available for this organization's ClickHouse.",
    });
    expect(shared.query).not.toHaveBeenCalled();
    expect(privateDrivers()).toEqual([]);
  });
});

describe("given a private ClickHouse where LangWatchQL is not set up", () => {
  const serverError = (code: string, type: string) =>
    Object.assign(new Error(`Code: ${code}. DB::Exception: refused. (${type})`), { code, type });

  /** @scenario "A LangWatchQL query on a private ClickHouse without LangWatchQL set up is refused" */
  it.each([
    ["516", "AUTHENTICATION_FAILED"],
    ["192", "UNKNOWN_USER"],
    ["81", "UNKNOWN_DATABASE"],
    ["60", "UNKNOWN_TABLE"],
  ])("refuses a %s %s as not set up, naming no URL or credential", async (code, type) => {
    const { executor, run } = fixture();
    await run(["project-private"]);
    privateDrivers()[0]?.query.mockRejectedValueOnce(serverError(code, type));

    const refusal = await run(["project-private"]).catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "lwql_unavailable",
      message: "LangWatchQL is not set up on this organization's ClickHouse yet.",
    });
    expect((refusal as Error).message).not.toMatch(/private\.invalid|route-user|route-password/);
    await executor.close();
  });

  it("keeps the shared ClickHouse's own refusal for the same failure there", async () => {
    const { shared, run } = fixture();
    shared.query.mockRejectedValueOnce(serverError("60", "UNKNOWN_TABLE"));

    await expect(run(["project-shared"])).rejects.toMatchObject({
      code: "lwql_unavailable",
      message: "The LangWatchQL analytics SQL API is not available on this deployment.",
    });
  });
});

describe("when the executor closes", () => {
  it("closes the shared executor and every private one", async () => {
    const { executor, run } = fixture();
    await run(["project-private"]);
    await run(["project-second-private"]);

    await executor.close();

    expect(drivers).toHaveLength(3);
    for (const driver of drivers) expect(driver.close).toHaveBeenCalledTimes(1);
  });
});

// A handled private_dataplane_unavailable keeps its own code and message.
describe("given the router refuses an organization with private_dataplane_unavailable", () => {
  class RouteMissingError extends HandledError {
    constructor() {
      super(
        "private_dataplane_unavailable",
        "This organization keeps its data on its own ClickHouse, which this deployment cannot reach",
        {
          httpStatus: 503,
          fault: "platform",
          retryable: false,
          meta: {
            organizationId: "org-labelled",
            kind: "clickhouse",
            variable: "CLICKHOUSE_URL__globex__org-labelled",
            problem: "missing",
          },
        },
      );
    }
  }

  it("rethrows that refusal unchanged and runs nothing on the shared ClickHouse", async () => {
    const refusal = new RouteMissingError();
    const executor = RoutedLangWatchQLExecutorRepository.create({
      connection: SHARED,
      route: () => Promise.reject(refusal),
      createExecutor: (input) => ClickHouseLangWatchQLExecutorRepository.create(input),
    });
    const [shared] = drivers;

    const thrown = await runOn({ executor, tenantIds: ["project-x"] }).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBe(refusal);
    expect(thrown).toMatchObject({ code: "private_dataplane_unavailable" });
    expect(shared?.query).not.toHaveBeenCalled();
  });
});

// A route URL with no usable origin is refused, never dialled as "null".
describe("given a private route whose URL has no usable origin", () => {
  it("refuses with lwql_unavailable, names no URL or credential, and builds no executor", async () => {
    const createExecutor = vi.fn(
      (input: Parameters<typeof ClickHouseLangWatchQLExecutorRepository.create>[0]) =>
        ClickHouseLangWatchQLExecutorRepository.create(input),
    );
    const executor = RoutedLangWatchQLExecutorRepository.create({
      connection: SHARED,
      route: () =>
        Promise.resolve({
          kind: "private",
          organizationId: "org-opaque",
          url: "clickhouse://u:p@host:9000/db",
        }),
      createExecutor,
    });

    const refusal = await runOn({ executor, tenantIds: ["project-x"] }).catch(
      (error: unknown) => error,
    );

    expect(refusal).toMatchObject({
      code: "lwql_unavailable",
      message: "LangWatchQL is not available for this organization's ClickHouse.",
    });
    expect((refusal as Error).message).not.toMatch(/clickhouse:\/\/|u:p|host:9000/);
    expect(createExecutor).toHaveBeenCalledTimes(1);
    expect(createExecutor.mock.calls[0]?.[0].target).toBe("shared");
    expect(drivers).toHaveLength(1);
  });
});

describe("given a private route whose path is not a plain ClickHouse database name", () => {
  const withPath = (path: string): TenantRoute => ({
    kind: "private",
    organizationId: "org-shape",
    url: `https://route-user:route-password@private.invalid:8443${path}`,
  });
  const attempt = (route: TenantRoute) => {
    const createExecutor = vi.fn(
      (input: Parameters<typeof ClickHouseLangWatchQLExecutorRepository.create>[0]) =>
        ClickHouseLangWatchQLExecutorRepository.create(input),
    );
    const executor = RoutedLangWatchQLExecutorRepository.create({
      connection: SHARED,
      route: () => Promise.resolve(route),
      createExecutor,
    });
    const run = () =>
      runOn({ executor, tenantIds: ["project-x"] }).catch((error: unknown) => error);

    return { createExecutor, run };
  };

  /** @scenario "A private route whose database is not a plain ClickHouse name is refused" */
  it.each([
    ["a hyphenated name", "/acme-db", /acme-db/],
    ["a path carrying SQL once decoded", "/x%3B%20DROP%20TABLE%20t", /DROP|x;|%3B/],
    ["a path with a second segment", "/acme_db/extra", /extra/],
    ["a name starting with a digit", "/1acme", /1acme/],
    ["a trailing slash", "/acme_db/", /acme_db/],
    ["a reserved database", "/system", /system/i],
    ["the other reserved database", "/information_schema", /information_schema/i],
    ["a reserved database in capitals", "/SYSTEM", /system/i],
    ["a name with capitals", "/AcmeDB", /acmedb/i],
  ])(
    "refuses %s, naming no part of the URL, and builds no private executor",
    async (_, path, leak) => {
      const { createExecutor, run } = attempt(withPath(path));

      const refusal = await run();

      expect(refusal).toMatchObject({
        code: "lwql_unavailable",
        message: "LangWatchQL is not available for this organization's ClickHouse.",
      });
      expect((refusal as Error).message).not.toMatch(leak);
      expect((refusal as Error).message).not.toMatch(/route-user|route-password|private\.invalid/);
      expect(createExecutor.mock.calls.map(([input]) => input.target)).toEqual(["shared"]);
      expect(privateDrivers()).toEqual([]);
    },
  );

  /** @scenario "A private route whose database is not a plain ClickHouse name is refused" */
  it.each([
    [
      "an unparsable URL",
      "http://route-user:route-secret-pw@[bad/x",
      "unparsable route URL",
      /bad\/x/,
    ],
    [
      "a malformed escape",
      "https://route-user:route-secret-pw@private.invalid:8443/%E0%A4%A",
      "unparsable route URL",
      /%E0|A4/,
    ],
    [
      "a non-http scheme",
      "ftp://route-user:route-secret-pw@private.invalid:8443/acme_db",
      "bad scheme",
      /ftp|acme_db/,
    ],
    [
      "a bad name shape",
      "https://route-user:route-secret-pw@private.invalid:8443/acme-db",
      "bad name shape",
      /acme-db/,
    ],
    [
      "a reserved database",
      "https://route-user:route-secret-pw@private.invalid:8443/system",
      "reserved database",
      /system/,
    ],
  ])("keeps no part of the URL in the reasons of %s", async (_, url, reason, pathLeak) => {
    const { run } = attempt({ kind: "private", organizationId: "org-shape", url });

    const refusal = (await run()) as HandledError;

    expect(refusal.reasons.map((r) => r.message)).toEqual([reason]);
    const dump = JSON.stringify([
      refusal.message,
      refusal.serialize(),
      refusal.meta,
      ...[refusal, ...refusal.reasons].map((error) =>
        Object.getOwnPropertyNames(error)
          .filter((name) => name !== "stack")
          .map((name) => String(Reflect.get(error, name))),
      ),
    ]);
    expect(dump).not.toMatch(/route-user|route-secret-pw|private\.invalid/);
    expect(dump).not.toMatch(pathLeak);
  });

  /** @scenario "A private route whose database is not a plain ClickHouse name is refused" */
  it("accepts a plain name and dials it", async () => {
    const { run } = attempt(withPath("/acme_db"));

    await run();

    expect(privateDrivers()[0]?.config).toMatchObject({ database: "acme_db" });
  });
});
