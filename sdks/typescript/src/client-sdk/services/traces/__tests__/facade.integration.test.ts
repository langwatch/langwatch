import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createLangWatchApiClient } from "@/internal/api/client";
import { NoOpLogger } from "@/logger";

import { TracesFacade } from "../facade";
import { TracesApiError } from "../traces-api.service";

const TEST_ENDPOINT = "http://localhost:5560";
const TRACE_ROUTE = `${TEST_ENDPOINT}/api/v1/traces/:traceId`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const facade = () =>
  new TracesFacade({
    langwatchApiClient: createLangWatchApiClient("test-key", TEST_ENDPOINT),
    logger: new NoOpLogger(),
  });

describe("given langwatch.traces reads through the CLI's trace service", () => {
  describe("when the platform answers the trace", () => {
    it("returns the body and sends the same bare request as before", async () => {
      const urls: string[] = [];
      server.use(
        http.get(TRACE_ROUTE, ({ request }) => {
          urls.push(request.url);
          return HttpResponse.json({ trace_id: "trace-abc", spans: [] });
        }),
      );

      const trace = await facade().get("trace-abc", { includeSpans: true });

      expect(trace).toEqual({ trace_id: "trace-abc", spans: [] });
      expect(urls).toEqual([`${TEST_ENDPOINT}/api/v1/traces/trace-abc`]);
    });
  });

  describe("when the platform fails without a domain error", () => {
    it("throws TracesApiError carrying the operation and status", async () => {
      server.use(
        http.get(TRACE_ROUTE, () =>
          HttpResponse.json({ error: "Internal server error", message: "boom" }, { status: 500 }),
        ),
      );

      const read = facade().get("trace-abc");

      await expect(read).rejects.toBeInstanceOf(TracesApiError);
      await expect(read).rejects.toMatchObject({ operation: 'get trace "trace-abc"', status: 500 });
    });
  });
});
