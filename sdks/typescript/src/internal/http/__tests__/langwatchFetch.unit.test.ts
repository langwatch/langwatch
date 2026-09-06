import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger";
import { createLangWatchApiClient } from "../../api/client";
import {
  createLangWatchFetch,
  LangWatchRedirectError,
  resetSchemeUpgradeWarnings,
} from "../langwatchFetch";

const HTTP_URL = "http://app.langwatch.ai/api/traces/search?limit=1";
const HTTPS_URL = "https://app.langwatch.ai/api/traces/search?limit=1";
const OTHER_PATH = "https://app.langwatch.ai/api/traces/search/?limit=1";
const OTHER_HOST = "https://other.example.com/api/traces/search?limit=1";

const redirect = ({
  status,
  location,
}: {
  status: number;
  location?: string;
}): Response =>
  new Response(null, {
    status,
    headers: location ? { location } : {},
  });

const ok = (body = "done"): Response => new Response(body, { status: 200 });

const opaqueRedirect = (): Response =>
  ({ type: "opaqueredirect", status: 0, headers: new Headers() }) as Response;

/** A transport answering each call from the script, in order. */
const scripted = (...responses: Response[]) => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const next = responses.shift();
    if (!next) throw new Error("the script ran out of responses");
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const headersOf = (call: { input: RequestInfo | URL; init?: RequestInit }): Headers =>
  call.input instanceof Request ? call.input.headers : new Headers(call.init?.headers);

const methodOf = (call: { input: RequestInfo | URL; init?: RequestInit }): string =>
  call.input instanceof Request ? call.input.method : (call.init?.method ?? "GET");

const CREDENTIALS = {
  Authorization: "Bearer sk-lw-secret",
  "X-Auth-Token": "sk-lw-secret",
  "X-Project-Id": "project_1",
  Accept: "application/json",
};

const silentLogger = () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger satisfies Logger;
};

const refusal = async (run: () => Promise<unknown>): Promise<LangWatchRedirectError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof LangWatchRedirectError) return error;
    throw error;
  }
  throw new Error("expected the redirect to be refused");
};

describe("langwatchFetch", () => {
  beforeEach(() => {
    resetSchemeUpgradeWarnings();
  });

  describe("given an http endpoint that redirects to the same URL over https", () => {
    describe("when a request is sent", () => {
      /** @scenario follows a redirect that only upgrades http to https */
      it("follows the redirect once and returns the https response", async () => {
        for (const method of ["GET", "POST"]) {
          const { fetchImpl, calls } = scripted(redirect({ status: 301, location: HTTPS_URL }), ok("https answer"));
          const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

          const response = await fetchLangWatch(HTTP_URL, { method });

          expect(response.status).toBe(200);
          expect(await response.text()).toBe("https answer");
          expect(calls.map((call) => urlOf(call.input))).toEqual([HTTP_URL, HTTPS_URL]);
          expect(calls[0]!.init?.redirect).toBe("manual");
          expect(calls[1]!.init?.redirect).toBe("manual");
        }
      });

      /** @scenario follows a redirect that only upgrades http to https */
      it("accepts a relative Location, an explicit default port and a fragment", async () => {
        for (const location of [
          "https://app.langwatch.ai:443/api/traces/search?limit=1",
          "https://app.langwatch.ai/api/traces/search?limit=1#section",
        ]) {
          const { fetchImpl, calls } = scripted(redirect({ status: 308, location }), ok());
          const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

          await fetchLangWatch(HTTP_URL, { method: "POST", body: "{}" });

          expect(calls[1] && urlOf(calls[1].input)).toBe(HTTPS_URL);
        }
      });

      /** @scenario replays the same method, headers and body on the upgrade */
      it("replays the method, the headers and the body bytes", async () => {
        const { fetchImpl, calls } = scripted(redirect({ status: 307, location: HTTPS_URL }), ok());
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });
        const body = JSON.stringify({ trace_id: "trace_1" });

        await fetchLangWatch(HTTP_URL, {
          method: "POST",
          headers: { Authorization: "Bearer sk-lw-secret", "Content-Type": "application/json" },
          body,
        });

        const replay = calls[1]!.init!;
        expect(replay.method).toBe("POST");
        expect(replay.headers).toEqual({
          Authorization: "Bearer sk-lw-secret",
          "Content-Type": "application/json",
        });
        expect(replay.body).toBe(body);
      });

      /** @scenario replays the same method, headers and body on the upgrade */
      it("replays a Request object with its method, headers and body bytes", async () => {
        const { fetchImpl, calls } = scripted(redirect({ status: 301, location: HTTPS_URL }), ok());
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });
        const body = JSON.stringify({ trace_id: "trace_1" });
        const request = new Request(HTTP_URL, {
          method: "POST",
          headers: { Authorization: "Bearer sk-lw-secret" },
          body,
        });

        await fetchLangWatch(request);

        const first = calls[0]!.input as Request;
        const replay = calls[1]!.input as Request;
        expect(first.redirect).toBe("manual");
        expect(replay.url).toBe(HTTPS_URL);
        expect(replay.method).toBe("POST");
        expect(replay.headers.get("authorization")).toBe("Bearer sk-lw-secret");
        expect(await replay.text()).toBe(body);
      });

      /** @scenario replays the same method, headers and body on the upgrade */
      it("replays what init overrode on the Request, not the Request's own fields", async () => {
        const { fetchImpl, calls } = scripted(redirect({ status: 301, location: HTTPS_URL }), ok());
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });
        const request = new Request(HTTP_URL, {
          method: "PATCH",
          headers: { Authorization: "Bearer stale", "X-Project-Id": "project_stale" },
          body: "stale",
        });

        await fetchLangWatch(request, {
          method: "PUT",
          headers: { Authorization: "Bearer sk-lw-secret" },
          body: "fresh",
        });

        const first = calls[0]!.input as Request;
        const replay = calls[1]!.input as Request;
        expect(first.method).toBe("PUT");
        expect(await first.text()).toBe("fresh");
        expect(replay.url).toBe(HTTPS_URL);
        expect(replay.method).toBe("PUT");
        expect(replay.headers.get("authorization")).toBe("Bearer sk-lw-secret");
        expect(replay.headers.get("x-project-id")).toBeNull();
        expect(await replay.text()).toBe("fresh");
      });

      /** @scenario follows a redirect that only upgrades http to https */
      it("takes the method from init when it overrides a GET Request", async () => {
        const { fetchImpl, calls } = scripted(redirect({ status: 308, location: HTTPS_URL }), ok());
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

        await fetchLangWatch(new Request(HTTP_URL), { method: "POST", body: "{}" });

        expect(calls.map((call) => urlOf(call.input))).toEqual([HTTP_URL, HTTPS_URL]);
        expect((calls[1]!.input as Request).method).toBe("POST");
        expect(await (calls[1]!.input as Request).text()).toBe("{}");
      });

      /** @scenario warns once per process about an http endpoint */
      it("warns once, naming the https endpoint to configure", async () => {
        const logger = silentLogger();
        const { fetchImpl } = scripted(
          redirect({ status: 301, location: HTTPS_URL }),
          ok(),
          redirect({ status: 301, location: HTTPS_URL }),
          ok(),
        );
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger });

        await fetchLangWatch(HTTP_URL);
        await fetchLangWatch(HTTP_URL, { method: "POST", body: "{}" });

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          "LangWatch endpoint http://app.langwatch.ai redirected to https. Set the endpoint to https://app.langwatch.ai to skip the extra round trip.",
        );
      });

      /** @scenario refuses to replay a streaming body */
      it("refuses to replay a ReadableStream body", async () => {
        const { fetchImpl, calls } = scripted(redirect({ status: 307, location: HTTPS_URL }), ok());
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          },
        });

        const error = await refusal(() =>
          fetchLangWatch(HTTP_URL, {
            method: "POST",
            body: stream,
            // @ts-expect-error duplex is required for streamed bodies in Node
            duplex: "half",
          }),
        );

        expect(error.status).toBe(307);
        expect(calls).toHaveLength(1);
      });
    });
  });

  describe("given a GET or HEAD answered with a redirect", () => {
    /** @scenario a GET follows a redirect to another path */
    it("follows a GET to another path on the same host", async () => {
      const { fetchImpl, calls } = scripted(redirect({ status: 301, location: OTHER_PATH }), ok("moved"));
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const response = await fetchLangWatch(HTTPS_URL, { method: "GET" });

      expect(await response.text()).toBe("moved");
      expect(calls.map((call) => urlOf(call.input))).toEqual([HTTPS_URL, OTHER_PATH]);
      expect(calls.map(methodOf)).toEqual(["GET", "GET"]);
      expect(calls[1]!.init?.redirect).toBe("manual");
    });

    /** @scenario a GET follows a redirect to another path */
    it("follows a GET given as a Request object and keeps the Request shape", async () => {
      const { fetchImpl, calls } = scripted(redirect({ status: 302, location: "/api/other" }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      await fetchLangWatch(new Request(HTTPS_URL, { headers: CREDENTIALS }));

      const hop = calls[1]!.input as Request;
      expect(hop.url).toBe("https://app.langwatch.ai/api/other");
      expect(hop.method).toBe("GET");
      expect(hop.redirect).toBe("manual");
      expect(hop.headers.get("x-auth-token")).toBe("sk-lw-secret");
    });

    /** @scenario a GET follows a chain of redirects up to five hops */
    it("follows five redirects in a row and returns the final response", async () => {
      const hops = [1, 2, 3, 4, 5].map((n) => `https://app.langwatch.ai/hop/${n}`);
      const { fetchImpl, calls } = scripted(
        ...hops.map((location, index) => redirect({ status: index % 2 === 0 ? 301 : 307, location })),
        ok("final"),
      );
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const response = await fetchLangWatch(HTTPS_URL);

      expect(await response.text()).toBe("final");
      expect(calls.map((call) => urlOf(call.input))).toEqual([HTTPS_URL, ...hops]);
      expect(calls.map(methodOf)).toEqual(Array(6).fill("GET"));
    });

    /** @scenario a GET refuses a sixth hop */
    it("refuses the sixth redirect with the fifth target as the URL", async () => {
      const hops = [1, 2, 3, 4, 5, 6].map((n) => `https://app.langwatch.ai/hop/${n}`);
      const { fetchImpl, calls } = scripted(
        ...hops.map((location, index) => redirect({ status: index === 5 ? 302 : 301, location })),
        ok(),
      );
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(HTTPS_URL));

      expect(calls).toHaveLength(6);
      expect(error.url).toBe(hops[4]);
      expect(error.location).toBe(hops[5]);
      expect(error.status).toBe(302);
    });

    /** @scenario a GET keeps its headers on a same origin redirect */
    it("keeps every header on a same origin hop", async () => {
      const { fetchImpl, calls } = scripted(redirect({ status: 302, location: OTHER_PATH }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      await fetchLangWatch(HTTPS_URL, { headers: CREDENTIALS });

      const hop = headersOf(calls[1]!);
      expect(hop.get("authorization")).toBe("Bearer sk-lw-secret");
      expect(hop.get("x-auth-token")).toBe("sk-lw-secret");
      expect(hop.get("x-project-id")).toBe("project_1");
      expect(hop.get("accept")).toBe("application/json");
    });

    /** @scenario a GET keeps its headers on a same origin redirect */
    it("keeps every header on an http to https upgrade of the same host and warns once", async () => {
      const logger = silentLogger();
      const { fetchImpl, calls } = scripted(redirect({ status: 301, location: OTHER_PATH }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger });

      await fetchLangWatch(HTTP_URL, { headers: CREDENTIALS });

      const hop = headersOf(calls[1]!);
      expect(hop.get("authorization")).toBe("Bearer sk-lw-secret");
      expect(hop.get("x-auth-token")).toBe("sk-lw-secret");
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    /** @scenario a GET drops credential headers on a cross origin redirect */
    it("drops Authorization, X-Auth-Token and X-Project-Id on a hop to another host", async () => {
      const logger = silentLogger();
      const { fetchImpl, calls } = scripted(redirect({ status: 302, location: OTHER_HOST }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger });

      await fetchLangWatch(HTTPS_URL, { headers: CREDENTIALS });

      expect(urlOf(calls[1]!.input)).toBe(OTHER_HOST);
      const hop = headersOf(calls[1]!);
      expect(hop.get("authorization")).toBeNull();
      expect(hop.get("x-auth-token")).toBeNull();
      expect(hop.get("x-project-id")).toBeNull();
      expect(hop.get("accept")).toBe("application/json");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    /** @scenario a GET drops credential headers on a cross origin redirect */
    it("drops credential headers on a hop to another port of the same host", async () => {
      const { fetchImpl, calls } = scripted(
        redirect({ status: 302, location: "https://app.langwatch.ai:8443/api/traces/search?limit=1" }),
        ok(),
      );
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      await fetchLangWatch(HTTPS_URL, { headers: CREDENTIALS });

      expect(headersOf(calls[1]!).get("authorization")).toBeNull();
    });

    /** @scenario a GET refuses a downgrade from https to http */
    it("refuses a GET downgrade from https to http", async () => {
      const { fetchImpl, calls } = scripted(redirect({ status: 301, location: HTTP_URL }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(HTTPS_URL));

      expect(calls).toHaveLength(1);
      expect(error.url).toBe(HTTPS_URL);
      expect(error.location).toBe(HTTP_URL);
      expect(error.status).toBe(301);
    });

    /** @scenario a GET refuses a downgrade from https to http */
    it("refuses a GET downgrade in the middle of a chain", async () => {
      const { fetchImpl, calls } = scripted(
        redirect({ status: 301, location: OTHER_PATH }),
        redirect({ status: 301, location: "http://app.langwatch.ai/api/plain" }),
        ok(),
      );
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(HTTPS_URL));

      expect(calls).toHaveLength(2);
      expect(error.url).toBe(OTHER_PATH);
      expect(error.location).toBe("http://app.langwatch.ai/api/plain");
    });

    /** @scenario a GET follows a 303 */
    it("follows a 303 as a GET", async () => {
      const { fetchImpl, calls } = scripted(redirect({ status: 303, location: OTHER_PATH }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      await fetchLangWatch(HTTPS_URL);

      expect(calls.map((call) => urlOf(call.input))).toEqual([HTTPS_URL, OTHER_PATH]);
      expect(methodOf(calls[1]!)).toBe("GET");
    });

    /** @scenario a HEAD follows a redirect like a GET */
    it("follows a HEAD with the same method", async () => {
      const { fetchImpl, calls } = scripted(redirect({ status: 301, location: OTHER_PATH }), new Response(null, { status: 200 }));
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const response = await fetchLangWatch(HTTPS_URL, { method: "head", headers: CREDENTIALS });

      expect(response.status).toBe(200);
      expect(calls.map((call) => urlOf(call.input))).toEqual([HTTPS_URL, OTHER_PATH]);
      expect(methodOf(calls[1]!)).toBe("HEAD");
      expect(headersOf(calls[1]!).get("authorization")).toBe("Bearer sk-lw-secret");
    });

    /** @scenario refuses a redirect without a location */
    it("refuses a GET redirect without a Location header", async () => {
      const { fetchImpl, calls } = scripted(redirect({ status: 302 }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(HTTPS_URL));

      expect(calls).toHaveLength(1);
      expect(error.location).toBeNull();
      expect(error.status).toBe(302);
    });
  });

  describe("given a POST answered with a redirect that is not an http to https upgrade", () => {
    const refuses = async ({
      url = HTTP_URL,
      status,
      location,
    }: {
      url?: string;
      status: number;
      location?: string;
    }) => {
      const { fetchImpl, calls } = scripted(redirect({ status, location }), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(url, { method: "POST", body: "{}" }));

      expect(calls).toHaveLength(1);
      expect(error.name).toBe("LangWatchRedirectError");
      expect(error.url).toBe(url);
      expect(error.location).toBe(location ?? null);
      expect(error.status).toBe(status);
      return error;
    };

    /** @scenario a POST refuses a redirect to another host */
    it("refuses a redirect to another host", async () => {
      const error = await refuses({ status: 301, location: OTHER_HOST });

      expect(error.message).toBe(
        "LangWatch refused to follow a redirect from http://app.langwatch.ai/api/traces/search?limit=1 to https://other.example.com/api/traces/search?limit=1 (HTTP 301). Set the endpoint to the final URL.",
      );
    });

    /** @scenario a POST refuses a redirect to another host */
    it("refuses a redirect to another port on the same host", async () => {
      await refuses({ status: 301, location: "https://app.langwatch.ai:8443/api/traces/search?limit=1" });
    });

    /** @scenario a POST still refuses a redirect to another path */
    it("refuses a redirect that changes the path", async () => {
      await refuses({ status: 308, location: OTHER_PATH });
    });

    /** @scenario a POST still refuses a redirect to another path */
    it("refuses a redirect that changes the query", async () => {
      await refuses({ status: 308, location: "https://app.langwatch.ai/api/traces/search?limit=2" });
    });

    /** @scenario a POST still refuses a redirect to another path */
    it("refuses a PUT, PATCH and DELETE redirect to another path as well", async () => {
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const { fetchImpl, calls } = scripted(redirect({ status: 301, location: OTHER_PATH }), ok());
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

        const error = await refusal(() => fetchLangWatch(HTTPS_URL, { method }));

        expect(calls).toHaveLength(1);
        expect(error.location).toBe(OTHER_PATH);
      }
    });

    /** @scenario a POST refuses a downgrade from https to http */
    it("refuses a downgrade from https to http", async () => {
      await refuses({ url: HTTPS_URL, status: 301, location: HTTP_URL });
    });

    /** @scenario a POST refuses a 303 */
    it("refuses a 303 even when it only upgrades the scheme", async () => {
      await refuses({ status: 303, location: HTTPS_URL });
    });

    /** @scenario refuses a redirect without a location */
    it("refuses a redirect without a Location header", async () => {
      const error = await refuses({ status: 302 });

      expect(error.message).toContain("to an unknown location (HTTP 302)");
    });

    /** @scenario refuses an opaque redirect */
    it("refuses an opaque redirect with status 0", async () => {
      for (const method of ["GET", "POST"]) {
        const { fetchImpl, calls } = scripted(opaqueRedirect(), ok());
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

        const error = await refusal(() => fetchLangWatch(HTTP_URL, { method }));

        expect(error.status).toBe(0);
        expect(error.location).toBeNull();
        expect(calls).toHaveLength(1);
      }
    });

    /** @scenario a POST refuses a second redirect after the upgrade */
    it("refuses a second redirect after the upgrade", async () => {
      const { fetchImpl, calls } = scripted(
        redirect({ status: 301, location: HTTPS_URL }),
        redirect({ status: 302, location: OTHER_PATH }),
        ok(),
      );
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(HTTP_URL, { method: "POST", body: "{}" }));

      expect(calls).toHaveLength(2);
      expect(error.url).toBe(HTTPS_URL);
      expect(error.location).toBe(OTHER_PATH);
      expect(error.status).toBe(302);
    });
  });

  describe("given a response that is not a redirect", () => {
    it("returns it untouched, a 304 included", async () => {
      for (const status of [200, 204, 304, 404, 500]) {
        const { fetchImpl, calls } = scripted(new Response(null, { status }));
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

        const response = await fetchLangWatch(HTTP_URL);

        expect(response.status).toBe(status);
        expect(calls).toHaveLength(1);
      }
    });
  });

  describe("given the generated API client", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    /** @scenario the generated API client uses the shared transport */
    it("sends through the shared transport and replays the upgrade with its headers", async () => {
      const { fetchImpl, calls } = scripted(
        redirect({ status: 301, location: "https://app.langwatch.ai/api/annotations" }),
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      );
      globalThis.fetch = fetchImpl;
      const client = createLangWatchApiClient("sk-lw-secret", "http://app.langwatch.ai");

      const { data, error } = await client.GET("/api/annotations");

      expect(error).toBeUndefined();
      expect(data).toEqual([]);
      expect(calls.map((call) => urlOf(call.input))).toEqual([
        "http://app.langwatch.ai/api/annotations",
        "https://app.langwatch.ai/api/annotations",
      ]);
      const replay = calls[1]!.input as Request;
      expect(replay.headers.get("x-auth-token")).toBe("sk-lw-secret");
      expect(replay.redirect).toBe("manual");
    });
  });
});
