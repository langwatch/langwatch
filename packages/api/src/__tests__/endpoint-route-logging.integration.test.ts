import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The request log records the path that ARRIVED. That is a different value on
 * every request once ids are in it, so "which endpoint is failing" could not be
 * asked of it — you could group by a url and get one row per caller.
 *
 * `route` is the endpoint that matched, as registered. These pin that it is the
 * pattern rather than the concrete path, that it survives the mounts where it
 * is easiest to lose (a version prefix, a withdrawal), and that it reaches the
 * one error that most needs it: a handler returning something its own schema
 * rejects.
 */

const logRecords: {
  level: string;
  payload: Record<string, unknown>;
  message: string;
}[] = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  const record =
    (level: string) => (payload: Record<string, unknown>, message: string) => {
      logRecords.push({ level, payload, message });
    };
  return {
    ...actual,
    createLogger: () => ({
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
    }),
  };
});

const { createService: createRawService } = await import("../builder.js");
const createService: typeof createRawService = ((
  config: Parameters<typeof createRawService>[0],
) =>
  createRawService(config).withoutPermission(
    "framework test endpoint",
  )) as typeof createRawService;

const requestRecords = () =>
  logRecords.filter(
    (r) => r.message === "error handling request" || r.message === "request handled",
  );

const routeOf = (index = 0) => requestRecords()[index]?.payload.route;

describe("the endpoint a request matched", () => {
  beforeEach(() => {
    logRecords.length = 0;
  });

  describe("given an endpoint carrying a path parameter", () => {
    function buildService() {
      return createService({ name: "things", basePath: "/api/things" })
        .registerRoute(
          "get",
          "/things/:id",
          "2026-08-07",
          async (_c, input: { id: string }) => ({ id: input.id }),
          (b) =>
            b
              .withParams(z.object({ id: z.string() }))
              .withOutput(z.object({ id: z.string() })),
        )
        .build();
    }

    describe("when a request arrives carrying a real id", () => {
      it("logs the registered pattern, not the path that arrived", async () => {
        const app = buildService();

        const res = await app.request("/api/things/2026-08-07/things/th_01J9Z");

        expect(res.status).toBe(200);
        expect(routeOf()).toBe("GET /things/:id");
      });

      /**
       * The two are different fields on purpose: one identifies the endpoint,
       * the other says what was actually called. Losing `url` would take the
       * id with it, which is the thing you need when reproducing.
       */
      it("keeps the concrete path alongside it", async () => {
        const app = buildService();

        await app.request("/api/things/2026-08-07/things/th_01J9Z");

        expect(requestRecords()[0]?.payload.url).toBe(
          "/api/things/2026-08-07/things/th_01J9Z",
        );
      });
    });
  });

  describe("given an endpoint mounted under two namespaces", () => {
    describe("when the dated and latest mounts are called", () => {
      it("reports the same route for both", async () => {
        const app = createService({ name: "things", basePath: "/api/things" })
          .registerRoute(
            "get",
            "/widgets",
            "2026-08-07",
            async () => [] as string[],
            (b) => b.withOutput(z.array(z.string())),
          )
          .build();

        await app.request("/api/things/2026-08-07/widgets");
        const dated = routeOf();
        logRecords.length = 0;

        await app.request("/api/things/latest/widgets");

        expect(dated).toBe("GET /widgets");
        expect(routeOf()).toBe("GET /widgets");
      });
    });
  });

  describe("given an endpoint withdrawn in a later version", () => {
    describe("when a caller still on it is answered 410", () => {
      it("still says which endpoint they were calling", async () => {
        const app = createService({ name: "things", basePath: "/api/things" })
          .registerRoute(
            "get",
            "/legacy",
            "2026-08-07",
            async () => "x",
            (b) => b.withOutput(z.string()),
          )
          .withdraw("/legacy", "2026-09-01")
          .build();

        const res = await app.request("/api/things/2026-09-01/legacy");

        expect(res.status).toBe(410);
        expect(routeOf()).toBe("GET /legacy");
      });
    });
  });

  /**
   * This stays a plain `Error`: we know the cause, but the caller cannot act on
   * it — the handler returned something its own declared schema rejects, which
   * is our bug, and it correctly degrades to "unknown" plus a trace id at the
   * boundary. What it lacked was saying WHICH endpoint broke its own contract.
   */
  describe("given a handler that returns something its schema rejects", () => {
    describe("when the response is serialised", () => {
      it("names the endpoint in the error", async () => {
        const app = createService({ name: "things", basePath: "/api/things" })
          .registerRoute(
            "get",
            "/broken",
            "2026-08-07",
            // biome-ignore lint/suspicious/noExplicitAny: returning the wrong shape is the case under test.
            async () => ({ id: "not-a-number" }) as any,
            (b) => b.withOutput(z.object({ id: z.number() })),
          )
          .build();

        const res = await app.request("/api/things/2026-08-07/broken");

        expect(res.status).toBe(500);
        const cause = requestRecords()[0]?.payload.error as
          | { message?: string }
          | undefined;
        expect(cause?.message).toContain("Response failed output validation");
        expect(cause?.message).toContain("GET /broken");
      });

      it("still answers the caller with an unknown error, not the detail", async () => {
        const app = createService({ name: "things", basePath: "/api/things" })
          .registerRoute(
            "get",
            "/broken",
            "2026-08-07",
            // biome-ignore lint/suspicious/noExplicitAny: returning the wrong shape is the case under test.
            async () => ({ id: "not-a-number" }) as any,
            (b) => b.withOutput(z.object({ id: z.number() })),
          )
          .build();

        const body = (await (
          await app.request("/api/things/2026-08-07/broken")
        ).json()) as Record<string, unknown>;

        expect(JSON.stringify(body)).not.toContain("not-a-number");
      });
    });
  });
});
