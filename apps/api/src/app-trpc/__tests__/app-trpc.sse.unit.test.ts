/**
 * The subscription lane's wire, proved frame by frame.
 *
 * Everything here is the protocol rather than any one procedure: the browser
 * half in `packages/platform-api-client` classifies on these exact shapes, so
 * a frame that changes here is a live view that goes quiet, and the failure
 * shows up as a stale screen rather than an error. The caller is two functions,
 * which is the point — the lane owns the wire, and the process owns the router.
 */
import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { OrganizationService } from "@langwatch/organization-contract";
import { getRoutePolicy, type AppRestSecurity } from "@langwatch/api/rest";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { ApiRestSecurity } from "../../api-rest.security";
import { ApiRestObservabilityComposition } from "../../app/api-rest-observability.composition";
import {
  createSseSubscriptionApp,
  sseErrorFrame,
  SSE_KEEPALIVE_INTERVAL_MS,
  type SseSubscriptionPorts,
} from "../app-trpc.sse";

class TestHandledError extends HandledError {
  constructor(code: string, message: string, fault: "customer" | "platform" = "customer") {
    super(code, message, { httpStatus: 400, fault });
    this.name = "TestHandledError";
  }
}

/**
 * A security bound to services that are never reached.
 *
 * The route declares `handlerManagedAuth`, and the builder applies NO chain
 * for that policy — so a request arriving with no credential still reaches the
 * handler. That is the shape being asserted, not an omission in the fixture.
 */
function testSecurity(): AppRestSecurity {
  const unreachable = <T extends object>(prototype: T): T =>
    new Proxy(prototype, {
      get: (target, property, receiver) => {
        if (property in target) {
          return () => {
            throw new Error(`${String(property)} was reached on the subscription lane`);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

  return ApiRestSecurity.create({
    apiKeys: unreachable(ApiKeyService.prototype),
    authz: unreachable(AuthzService.prototype),
    organizations: unreachable(OrganizationService.prototype),
    observability: ApiRestObservabilityComposition.create(),
  });
}

const silentLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function laneOver(
  caller: unknown,
  overrides: Partial<SseSubscriptionPorts> = {},
): {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  createCaller: ReturnType<typeof vi.fn>;
} {
  const createCaller = vi.fn(async () => caller);
  const app = createSseSubscriptionApp({
    security: testSecurity(),
    ports: { createCaller, ...overrides },
    logger: silentLogger,
  });
  return {
    request: async (path, init) => app.hono.request(path, init),
    createCaller,
  };
}

/** Every `data:` frame a response body carried, decoded the way the client does. */
async function framesOf(response: Response): Promise<unknown[]> {
  const body = await response.text();
  return body
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n"),
    )
    .filter((payload) => payload.length > 0)
    .map((payload) => superjson.parse(payload));
}

describe("the API subscription lane", () => {
  describe("given a procedure that yields an async iterable", () => {
    it("frames a connected ack, every value, and a terminal complete", async () => {
      const lane = laneOver({
        traces: {
          onTraceUpdate: async function* () {
            yield { trace_id: "trace-1" };
            yield { trace_id: "trace-2" };
          },
        },
      });

      const response = await lane.request("/api/sse/traces.onTraceUpdate");

      expect(response.status).toBe(200);
      await expect(framesOf(response)).resolves.toEqual([
        { type: "connected" },
        { trace_id: "trace-1" },
        { trace_id: "trace-2" },
        { type: "complete" },
      ]);
    });

    it("publishes the headers a proxy must not buffer or cache", async () => {
      const lane = laneOver({ ping: async function* () {} });

      const response = await lane.request("/api/sse/ping");

      expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    });

    it("hands the procedure the superjson input off the query string", async () => {
      const seen: unknown[] = [];
      const since = new Date("2026-09-02T00:00:00.000Z");
      const lane = laneOver({
        watch: async function* (input: unknown) {
          seen.push(input);
        },
      });

      await lane.request(
        `/api/sse/watch?input=${encodeURIComponent(superjson.stringify({ projectId: "p1", since }))}`,
      );

      // A Date rather than a string is what proves superjson decoded it: a
      // JSON.parse would have handed the procedure the ISO text.
      expect(seen).toEqual([{ projectId: "p1", since }]);
    });
  });

  describe("given a procedure that returns an observable", () => {
    it("frames each emission and completes the stream when it completes", async () => {
      const lane = laneOver({
        presence: {
          onPresenceUpdate: () => ({
            subscribe(observer: { next(v: unknown): void; complete(): void }) {
              observer.next({ userId: "u1" });
              observer.complete();
              return () => undefined;
            },
          }),
        },
      });

      const response = await lane.request("/api/sse/presence.onPresenceUpdate");

      await expect(framesOf(response)).resolves.toEqual([
        { type: "connected" },
        { userId: "u1" },
        { type: "complete" },
      ]);
    });

    it("unsubscribes a live observable when the browser goes away", async () => {
      const unsubscribe = vi.fn();
      const lane = laneOver({
        // A channel that never completes on its own — the only shape whose
        // teardown a client disconnect is responsible for.
        watch: () => ({ subscribe: () => unsubscribe }),
      });
      const client = new AbortController();

      await lane.request("/api/sse/watch", { signal: client.signal });
      expect(unsubscribe).not.toHaveBeenCalled();
      client.abort();

      expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it("writes the handled error's code as the protocol error frame", async () => {
      const lane = laneOver({
        watch: () => ({
          subscribe(observer: { error(err: unknown): void }) {
            observer.error(new TestHandledError("workbench_disabled", "Workbench is off here"));
            return () => undefined;
          },
        }),
      });

      const response = await lane.request("/api/sse/watch");
      const frames = await framesOf(response);

      expect(frames[0]).toEqual({ type: "connected" });
      expect(frames[1]).toMatchObject({ type: "error", message: "workbench_disabled" });
    });
  });

  describe("given a request that names no reachable procedure", () => {
    it("refuses a bare /api/sse with 400 rather than opening a stream", async () => {
      const lane = laneOver({});

      const response = await lane.request("/api/sse");

      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).not.toContain("text/event-stream");
    });

    it("answers 404 for a path the caller has no procedure at", async () => {
      const lane = laneOver({ traces: { onTraceUpdate: async function* () {} } });

      const response = await lane.request("/api/sse/traces.onSomethingElse");

      expect(response.status).toBe(404);
    });

    it("reads a slash-separated path as the same dotted procedure", async () => {
      const lane = laneOver({ traces: { onTraceUpdate: async function* () {} } });

      const response = await lane.request("/api/sse/traces/onTraceUpdate");

      expect(response.status).toBe(200);
    });
  });

  describe("given the browser's own abort signal", () => {
    it("hands it to the caller factory so a suspended procedure is interrupted", async () => {
      const lane = laneOver({ watch: async function* () {} });

      await lane.request("/api/sse/watch");

      const call = lane.createCaller.mock.calls[0]?.[0] as {
        request: Request;
        signal: AbortSignal | undefined;
      };
      expect(call.request).toBeInstanceOf(Request);
      // Hono's test request carries one; what matters is that the lane passes
      // through whatever the runtime gave it rather than dropping it.
      expect(call.signal ?? null).toBe(call.request.signal ?? null);
    });
  });

  describe("given the route registry", () => {
    it("declares session-credential handler-managed access with an empty permission list", () => {
      laneOver({});

      const route = getRoutePolicy("GET", "/api/sse/*");

      expect(route?.policy).toMatchObject({
        kind: "handlerManaged",
        credential: "session",
        permissions: [],
      });
    });
  });

  describe("the keep-alive pin", () => {
    it("states the interval the host has always used", () => {
      expect(SSE_KEEPALIVE_INTERVAL_MS).toBe(25_000);
    });
  });
});

describe("sseErrorFrame", () => {
  describe("given a handled error", () => {
    it("rides the code, not the server-side message, and carries the serialized error", () => {
      const handled = new TestHandledError("rate_limited", "Slow down, project p1 on shard 3");

      expect(sseErrorFrame(handled)).toEqual({
        type: "error",
        message: "rate_limited",
        error: handled.serialize(),
      });
    });

    it("finds one wrapped as a TRPCError cause", () => {
      const handled = new TestHandledError("workbench_disabled", "off");
      const wrapped = new TRPCError({ code: "FORBIDDEN", message: "nope", cause: handled });

      expect(sseErrorFrame(wrapped)).toMatchObject({
        type: "error",
        message: "workbench_disabled",
      });
    });
  });

  describe("given an unhandled failure", () => {
    it("keeps a client-safe TRPCError's own message", () => {
      expect(sseErrorFrame(new TRPCError({ code: "NOT_FOUND", message: "No such run" }))).toEqual({
        type: "error",
        message: "No such run",
      });
    });

    it("degrades an internal TRPCError to the generic unknown", () => {
      const internal = new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "connect ECONNREFUSED clickhouse:9000",
      });

      expect(sseErrorFrame(internal)).toEqual({
        type: "error",
        message: "An unknown error occurred",
      });
    });

    it("degrades a plain Error rather than putting its message on the wire", () => {
      expect(sseErrorFrame(new Error("CREDENTIALS_SECRET is unset"))).toEqual({
        type: "error",
        message: "An unknown error occurred",
      });
    });
  });
});
