/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import type { PermissionDecision } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Authorize } from "../access/access.ts";
import {
  isUpgradeInProgress,
  promoteStoreFailure,
  setLedgerCurrent,
  setOrganizationsCatchingUp,
} from "../errors.ts";
import { SessionReader } from "../hosting/session-reader.ts";
import { canonicalErrorResponse, withRetryAfter } from "../rest/response.ts";
import { composeTrpcRouters } from "../trpc/compose.ts";
import { TrpcHost } from "../trpc/host.ts";
import { defineTrpcRouter } from "../trpc/runtime.ts";
import { SseLane } from "../trpc/sse.ts";
import { createApiDouble } from "./api-double.ts";

const schemaBehind = (code: string) =>
  Object.assign(new Error("The table `public.NewThing` does not exist"), { code });

/** Shaped as Prisma 7.10 raises a failed `$queryRaw`: P2010 over the adapter-pg driver error. */
const rawQueryFailed = ({ originalCode, kind }: { originalCode: string; kind: string }) => {
  const driverAdapterError = Object.assign(new Error(kind), {
    name: "DriverAdapterError",
    cause: { originalCode, originalMessage: 'relation "NewThing" does not exist', kind },
  });
  return Object.assign(
    new Error(
      `Raw query failed. Code: \`${originalCode}\`. Message: \`relation "NewThing" does not exist\``,
    ),
    { code: "P2010", meta: { driverAdapterError } },
  );
};

async function restAnswerFor(failure: unknown): Promise<Response> {
  const app = new Hono();
  app.get("/read", () => {
    throw failure;
  });
  app.onError(withRetryAfter((error, c) => canonicalErrorResponse(error, c)));
  return app.request("/read");
}

interface ThingApi {
  read(input: { id: string }): { id: string };
}

const ThingApi = moduleApi<ThingApi>()("annotation");

const thingReads = defineTrpcRouter(
  ThingApi,
  defineTrpcContract("things")
    .query("read")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(z.object({ id: z.string() }))
    .build(),
)
  .procedure("read")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.read(input))
  .build();

async function trpcAnswerFor(failure: unknown): Promise<Response> {
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz: createApiDouble<Authorize>({
      getDecision: async (): Promise<PermissionDecision> => ({
        permitted: true,
        organizationRole: "MEMBER",
      }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
      organizationOf: async () => null,
      projectKindOf: async () => "application",
    }),
  });
  trpc.mount(composeTrpcRouters("things", [thingReads]), () => ({
    read: () => {
      throw failure;
    },
  }));
  const input = encodeURIComponent(JSON.stringify({ projectId: "p1", id: "t1" }));
  const request = new Request(`http://api.test${TrpcHost.path}/things.read?input=${input}`);

  return fetchRequestHandler({
    endpoint: TrpcHost.path,
    req: request,
    router: trpc.router,
    createContext: () => trpc.context({ request }),
    allowBatching: false,
    responseMeta: ({ errors }) => ({ headers: trpc.retryAfterHeaders({ errors }) }),
  });
}

describe("a Postgres read the schema is not ready for", () => {
  describe("when a REST handler's query names a table or column a pending step adds", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it.each(["P2021", "P2022", "42P01", "42703"])(
      "answers %s as 503 upgrade_in_progress with Retry-After",
      async (code) => {
        const response = await restAnswerFor(schemaBehind(code));

        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("10");
        expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
      },
    );
  });

  describe("when a tRPC query's does", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it("answers 503 upgrade_in_progress with the same Retry-After as REST", async () => {
      const response = await trpcAnswerFor(schemaBehind("P2022"));

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("10");
      expect(await response.text()).toContain('"message":"upgrade_in_progress"');
    });
  });

  describe("when a live subscription's query does", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it("ends the stream with the handled upgrade_in_progress frame", async () => {
      const lane = SseLane.create({
        members: {
          createCaller: async () => ({
            traces: {
              watch: async () => {
                throw schemaBehind("P2022");
              },
            },
          }),
          procedureTypeAt: () => "subscription",
        },
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      });

      const response = await lane.answer(
        new Request("http://api.test/api/sse/traces/watch", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
        new Headers(),
      );

      expect(await response.text()).toContain('"message":"upgrade_in_progress"');
    });
  });
});

describe("a Postgres read the schema is not ready for once the gate admitted", () => {
  afterEach(() => setLedgerCurrent({ current: false }));

  /** @scenario "A missing table on a ledger that says current is not reported as upgrading" */
  it.each(["P2021", "P2022", "42P01", "42703"])(
    "answers %s as an unhandled 500 that names the table, never upgrade_in_progress",
    async (code) => {
      setLedgerCurrent({ current: true });
      const response = await restAnswerFor(schemaBehind(code));

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "internal_error" });
      const promoted = promoteStoreFailure(schemaBehind(code));
      expect(promoted).toBeInstanceOf(Error);
      expect(promoted instanceof Error ? promoted.message : "").toBe(
        "schema and ledger disagree: The table `public.NewThing` does not exist",
      );
    },
  );
});

describe("a raw SQL read the schema is not ready for", () => {
  afterEach(() => setLedgerCurrent({ current: false }));

  describe("when Prisma reports the failed raw query as P2010", () => {
    /** @scenario "A raw SQL read the schema is not ready for answers upgrade_in_progress" */
    it.each([
      { originalCode: "42P01", kind: "TableDoesNotExist" },
      { originalCode: "42703", kind: "ColumnNotFound" },
    ])("answers $originalCode as 503 upgrade_in_progress with Retry-After", async (failure) => {
      const response = await restAnswerFor(rawQueryFailed(failure));

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("10");
      expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
    });
  });

  describe("when a repository wraps the failure in its own error", () => {
    /** @scenario "A raw SQL read the schema is not ready for answers upgrade_in_progress" */
    it("finds the code down the cause chain", async () => {
      const wrapped = new Error("listing things failed", {
        cause: rawQueryFailed({ originalCode: "42P01", kind: "TableDoesNotExist" }),
      });

      const response = await restAnswerFor(wrapped);

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
    });
  });

  describe("when the raw query failed for another reason", () => {
    /** @scenario "A raw SQL read the schema is not ready for answers upgrade_in_progress" */
    it.each([
      { originalCode: "22P02", kind: "InvalidInputValue" },
      { originalCode: "42704", kind: "postgres" },
    ])("answers $originalCode as an unhandled 500", async (failure) => {
      const response = await restAnswerFor(rawQueryFailed(failure));

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "internal_error" });
    });

    /** @scenario "A raw SQL read the schema is not ready for answers upgrade_in_progress" */
    it("stops walking a cause chain that loops", async () => {
      const looped = new Error("first");
      looped.cause = new Error("second", { cause: looped });

      const response = await restAnswerFor(looped);

      expect(response.status).toBe(500);
    });
  });

  describe("when the gate already admitted the process", () => {
    /** @scenario "A missing table on a ledger that says current is not reported as upgrading" */
    it("answers a raw missing table as an unhandled 500, never upgrade_in_progress", async () => {
      setLedgerCurrent({ current: true });

      const response = await restAnswerFor(
        rawQueryFailed({ originalCode: "42P01", kind: "TableDoesNotExist" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "internal_error" });
    });
  });
});

/** Shaped as `@clickhouse/client` raises it, or as the routing driver fails an in-band error. */
const clickHouseFailed = ({ code, type }: { code: string; type?: string }) =>
  Object.assign(new Error("Unknown table expression identifier 'usage_trace_meter'"), {
    code,
    type,
  });

describe("a ClickHouse read the schema is not ready for", () => {
  afterEach(() => setLedgerCurrent({ current: false }));

  describe("when the query names a table or column a pending migration adds", () => {
    /** @scenario "A ClickHouse read the schema is not ready for answers upgrade_in_progress" */
    it.each([
      { code: "60", type: "UNKNOWN_TABLE" },
      { code: "16", type: "NO_SUCH_COLUMN_IN_TABLE" },
      { code: "60" },
    ])("answers $code $type as 503 upgrade_in_progress with Retry-After", async (failure) => {
      const response = await restAnswerFor(clickHouseFailed(failure));

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("10");
      expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
    });
  });

  describe("when the query failed for another reason", () => {
    /** @scenario "A ClickHouse read the schema is not ready for answers upgrade_in_progress" */
    it("answers a syntax error as an unhandled 500", async () => {
      const response = await restAnswerFor(clickHouseFailed({ code: "62", type: "SYNTAX_ERROR" }));

      expect(response.status).toBe(500);
    });
  });

  describe("when the gate already admitted the process", () => {
    /** @scenario "A missing table on a ledger that says current is not reported as upgrading" */
    it("answers a missing ClickHouse table as an unhandled 500", async () => {
      setLedgerCurrent({ current: true });

      const response = await restAnswerFor(clickHouseFailed({ code: "60", type: "UNKNOWN_TABLE" }));

      expect(response.status).toBe(500);
    });
  });
});

/** A ClickHouse UNKNOWN_TABLE as the routing driver tags it with the private target it reached. */
const unknownTableFrom = (privateTarget: string) =>
  Object.assign(
    new Error("Table langwatch.new_thing does not exist", {
      cause: Object.assign(new Error("Table langwatch.new_thing does not exist"), {
        code: "60",
        type: "UNKNOWN_TABLE",
      }),
    }),
    { privateTarget, code: "60", type: "UNKNOWN_TABLE" },
  );

describe("a ClickHouse read from a private target once the gate admitted", () => {
  afterEach(() => {
    setLedgerCurrent({ current: false });
    setOrganizationsCatchingUp({ organizationIds: [] });
  });

  describe("when the worker shares that the target is still catching up", () => {
    /** @scenario "A ClickHouse read from a private target still catching up answers upgrade_in_progress after admission" */
    it("answers 503 upgrade_in_progress with Retry-After and logs below error", async () => {
      setLedgerCurrent({ current: true });
      setOrganizationsCatchingUp({ organizationIds: ["org_private"] });

      const response = await restAnswerFor(unknownTableFrom("org_private"));

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("10");
      expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
      expect(isUpgradeInProgress(unknownTableFrom("org_private"))).toBe(true);
    });
  });

  describe("when the failing target is not the one catching up", () => {
    /** @scenario "A ClickHouse read the schema is not ready for on a current target stays a 500 after admission" */
    it("answers an unhandled 500 that says the schema and ledger disagree", async () => {
      setLedgerCurrent({ current: true });
      setOrganizationsCatchingUp({ organizationIds: ["org_other"] });

      const response = await restAnswerFor(unknownTableFrom("org_private"));

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "internal_error" });
      expect(isUpgradeInProgress(unknownTableFrom("org_private"))).toBe(false);
    });

    /** @scenario "A ClickHouse read the schema is not ready for on a current target stays a 500 after admission" */
    it("answers an untagged UNKNOWN_TABLE as a 500 even while a target catches up", async () => {
      setLedgerCurrent({ current: true });
      setOrganizationsCatchingUp({ organizationIds: ["org_private"] });
      const untagged = Object.assign(new Error("Table langwatch.new_thing does not exist"), {
        code: "60",
        type: "UNKNOWN_TABLE",
      });

      const promoted = promoteStoreFailure(untagged);

      expect(promoted instanceof Error ? promoted.message : "").toBe(
        "schema and ledger disagree: Table langwatch.new_thing does not exist",
      );
    });
  });

  describe("when Redis could not be read, so the shared list is empty", () => {
    /** @scenario "A process that cannot read the catching-up targets from Redis answers as before" */
    it("answers the tagged failure as an unhandled 500, as before", async () => {
      setLedgerCurrent({ current: true });
      setOrganizationsCatchingUp({ organizationIds: [] });

      const response = await restAnswerFor(unknownTableFrom("org_private"));

      expect(response.status).toBe(500);
    });
  });
});
