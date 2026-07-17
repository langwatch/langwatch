/**
 * The transport's error path, driven end to end.
 *
 * These go through the REAL openapi-fetch client and the REAL service wrapper,
 * with only the network faked, because the thing under test is a middleware that
 * sits between them: asserting on a parser in isolation would prove nothing
 * about whether a service actually throws what these tests say it throws.
 *
 * The wire shapes below are not invented. They are what
 * `langwatch/src/app/api/middleware/error-handler.ts` emits — the handler every
 * `SecuredApp` mounts via `onError` — which flattens a `DomainError` to
 * `{ error: <kind>, message, ...meta }` at its `httpStatus`.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { TracesApiService, TracesApiError } from "@/client-sdk/services/traces/traces-api.service";
import { createLangWatchApiClient } from "../client";
import { LangWatchDomainError, isLangWatchDomainError } from "../errors";

const TEST_ENDPOINT = "http://localhost:5560";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const serviceWithApiKey = (apiKey = "test-key") =>
  new TracesApiService({
    langwatchApiClient: createLangWatchApiClient(apiKey, TEST_ENDPOINT),
  });

const getTrace = (service: TracesApiService) => service.get("trace-abc");

describe("given the API returns a handled domain error", () => {
  describe("when the body is the flattened shape the shared error handler emits", () => {
    beforeEach(() => {
      server.use(
        http.get(`${TEST_ENDPOINT}/api/traces/:traceId`, () =>
          HttpResponse.json(
            {
              error: "trace_not_found",
              message: "Trace not found: trace-abc",
              // `meta` is SPREAD across the top level by the server handler.
              id: "trace-abc",
              projectId: "project-1",
            },
            { status: 404 },
          ),
        ),
      );
    });

    it("throws a typed domain error rather than a generic HTTP error", async () => {
      await expect(getTrace(serviceWithApiKey())).rejects.toBeInstanceOf(
        LangWatchDomainError,
      );
    });

    it("carries the platform's kind, status and meta", async () => {
      const error = await getTrace(serviceWithApiKey()).catch((e: unknown) => e);

      expect(isLangWatchDomainError(error)).toBe(true);
      const domain = error as LangWatchDomainError;

      expect(domain.kind).toBe("trace_not_found");
      expect(domain.httpStatus).toBe(404);
      expect(domain.meta).toEqual({ id: "trace-abc", projectId: "project-1" });
    });

    it("keeps the platform's sentence as the message", async () => {
      const error = (await getTrace(serviceWithApiKey()).catch(
        (e: unknown) => e,
      )) as LangWatchDomainError;

      expect(error.message).toBe("Trace not found: trace-abc");
    });

    it("keeps the raw body reachable as an escape hatch", async () => {
      const error = (await getTrace(serviceWithApiKey()).catch(
        (e: unknown) => e,
      )) as LangWatchDomainError;

      expect(error.body).toMatchObject({ error: "trace_not_found" });
    });
  });

  describe("when the route forwards the serialised DomainError verbatim", () => {
    beforeEach(() => {
      server.use(
        http.get(`${TEST_ENDPOINT}/api/traces/:traceId`, () =>
          HttpResponse.json(
            {
              error: "Could not reach the model gateway",
              domainError: {
                kind: "model_provider_unavailable",
                meta: { provider: "openai" },
                httpStatus: 424,
                telemetry: {
                  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                  spanId: "00f067aa0ba902b7",
                },
                reasons: [
                  { kind: "gateway_timeout", meta: { afterMs: 30000 } },
                  { kind: "unknown" },
                ],
              },
            },
            { status: 424 },
          ),
        ),
      );
    });

    it("populates the trace id so support can correlate the failure", async () => {
      const error = (await getTrace(serviceWithApiKey()).catch(
        (e: unknown) => e,
      )) as LangWatchDomainError;

      expect(error.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    });

    it("populates the reason chain behind the failure", async () => {
      const error = (await getTrace(serviceWithApiKey()).catch(
        (e: unknown) => e,
      )) as LangWatchDomainError;

      expect(error.kind).toBe("model_provider_unavailable");
      expect(error.meta).toEqual({ provider: "openai" });
      expect(error.reasons).toEqual([
        { kind: "gateway_timeout", meta: { afterMs: 30000 } },
        { kind: "unknown" },
      ]);
    });
  });
});

describe("given the API fails WITHOUT naming a domain error", () => {
  describe("when the platform falls over with a 500", () => {
    beforeEach(() => {
      server.use(
        http.get(`${TEST_ENDPOINT}/api/traces/:traceId`, () =>
          HttpResponse.json(
            { error: "Internal server error", message: "boom" },
            { status: 500 },
          ),
        ),
      );
    });

    it("throws the generic service error exactly as it did before", async () => {
      const error = await getTrace(serviceWithApiKey()).catch((e: unknown) => e);

      // A 5xx is OUR failure, not the caller's. Typing it as a domain error
      // would present an outage as something the user did wrong.
      expect(isLangWatchDomainError(error)).toBe(false);
      expect(error).toBeInstanceOf(TracesApiError);
      expect((error as TracesApiError).status).toBe(500);
    });
  });

  describe("when the body is not the platform's shape at all", () => {
    beforeEach(() => {
      server.use(
        http.get(`${TEST_ENDPOINT}/api/traces/:traceId`, () =>
          HttpResponse.json({ message: "no error field here" }, { status: 404 }),
        ),
      );
    });

    it("throws the generic service error", async () => {
      const error = await getTrace(serviceWithApiKey()).catch((e: unknown) => e);

      expect(isLangWatchDomainError(error)).toBe(false);
      expect(error).toBeInstanceOf(TracesApiError);
    });
  });

  describe("when a proxy returns an HTML error page", () => {
    beforeEach(() => {
      server.use(
        http.get(
          `${TEST_ENDPOINT}/api/traces/:traceId`,
          () =>
            new HttpResponse("<html><body>502 Bad Gateway</body></html>", {
              status: 502,
              headers: { "content-type": "text/html" },
            }),
        ),
      );
    });

    it("throws the generic service error without crashing on the unparseable body", async () => {
      const error = await getTrace(serviceWithApiKey()).catch((e: unknown) => e);

      expect(isLangWatchDomainError(error)).toBe(false);
      expect(error).toBeInstanceOf(TracesApiError);
    });
  });

  describe("when a body claims to be JSON but is truncated", () => {
    beforeEach(() => {
      server.use(
        http.get(
          `${TEST_ENDPOINT}/api/traces/:traceId`,
          () =>
            new HttpResponse('{"error": "trace_not_f', {
              status: 404,
              headers: { "content-type": "application/json" },
            }),
        ),
      );
    });

    it("falls through to the generic error rather than throwing on the parse", async () => {
      const error = await getTrace(serviceWithApiKey()).catch((e: unknown) => e);

      expect(isLangWatchDomainError(error)).toBe(false);
      expect(error).toBeInstanceOf(TracesApiError);
    });
  });
});
