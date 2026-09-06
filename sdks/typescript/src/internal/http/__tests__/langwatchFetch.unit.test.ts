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

const redirect = (status: number, location?: string): Response =>
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
        const { fetchImpl, calls } = scripted(redirect(301, HTTPS_URL), ok("https answer"));
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

        const response = await fetchLangWatch(HTTP_URL, { method: "GET" });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("https answer");
        expect(calls.map((call) => urlOf(call.input))).toEqual([HTTP_URL, HTTPS_URL]);
        expect(calls[0]!.init?.redirect).toBe("manual");
        expect(calls[1]!.init?.redirect).toBe("manual");
      });

      /** @scenario follows a redirect that only upgrades http to https */
      it("accepts a relative Location, an explicit default port and a fragment", async () => {
        for (const location of [
          "https://app.langwatch.ai:443/api/traces/search?limit=1",
          "https://app.langwatch.ai/api/traces/search?limit=1#section",
        ]) {
          const { fetchImpl, calls } = scripted(redirect(308, location), ok());
          const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

          await fetchLangWatch(HTTP_URL);

          expect(calls[1] && urlOf(calls[1].input)).toBe(HTTPS_URL);
        }
      });

      /** @scenario replays the same method, headers and body on the upgrade */
      it("replays the method, the headers and the body bytes", async () => {
        const { fetchImpl, calls } = scripted(redirect(307, HTTPS_URL), ok());
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
        const { fetchImpl, calls } = scripted(redirect(301, HTTPS_URL), ok());
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

      /** @scenario warns once per process about an http endpoint */
      it("warns once, naming the https endpoint to configure", async () => {
        const logger = silentLogger();
        const { fetchImpl } = scripted(
          redirect(301, HTTPS_URL),
          ok(),
          redirect(301, HTTPS_URL),
          ok(),
        );
        const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger });

        await fetchLangWatch(HTTP_URL);
        await fetchLangWatch(HTTP_URL);

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          "LangWatch endpoint http://app.langwatch.ai redirected to https. Set the endpoint to https://app.langwatch.ai to skip the extra round trip.",
        );
      });

      /** @scenario refuses to replay a streaming body */
      it("refuses to replay a ReadableStream body", async () => {
        const { fetchImpl, calls } = scripted(redirect(307, HTTPS_URL), ok());
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

  describe("given a redirect that is not an http to https upgrade", () => {
    const refuses = async ({
      url = HTTP_URL,
      status,
      location,
    }: {
      url?: string;
      status: number;
      location?: string;
    }) => {
      const { fetchImpl, calls } = scripted(redirect(status, location), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(url, { method: "POST", body: "{}" }));

      expect(calls).toHaveLength(1);
      expect(error.name).toBe("LangWatchRedirectError");
      expect(error.url).toBe(url);
      expect(error.location).toBe(location ?? null);
      expect(error.status).toBe(status);
      return error;
    };

    /** @scenario refuses a redirect to another host */
    it("refuses a redirect to another host", async () => {
      const error = await refuses({
        status: 301,
        location: "https://other.example.com/api/traces/search?limit=1",
      });

      expect(error.message).toBe(
        "LangWatch refused to follow a redirect from http://app.langwatch.ai/api/traces/search?limit=1 to https://other.example.com/api/traces/search?limit=1 (HTTP 301). Set the endpoint to the final URL.",
      );
    });

    /** @scenario refuses a redirect to another host */
    it("refuses a redirect to another port on the same host", async () => {
      await refuses({ status: 301, location: "https://app.langwatch.ai:8443/api/traces/search?limit=1" });
    });

    /** @scenario refuses a redirect that changes the path or query */
    it("refuses a redirect that changes the path", async () => {
      await refuses({ status: 308, location: "https://app.langwatch.ai/api/traces/search/?limit=1" });
    });

    /** @scenario refuses a redirect that changes the path or query */
    it("refuses a redirect that changes the query", async () => {
      await refuses({ status: 308, location: "https://app.langwatch.ai/api/traces/search?limit=2" });
    });

    /** @scenario refuses a downgrade from https to http */
    it("refuses a downgrade from https to http", async () => {
      await refuses({ url: HTTPS_URL, status: 301, location: HTTP_URL });
    });

    /** @scenario refuses a 303 */
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
      const { fetchImpl, calls } = scripted(opaqueRedirect(), ok());
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(HTTP_URL));

      expect(error.status).toBe(0);
      expect(error.location).toBeNull();
      expect(calls).toHaveLength(1);
    });

    /** @scenario refuses a second redirect after the upgrade */
    it("refuses a second redirect after the upgrade", async () => {
      const { fetchImpl, calls } = scripted(
        redirect(301, HTTPS_URL),
        redirect(302, "https://app.langwatch.ai/api/traces/search/?limit=1"),
        ok(),
      );
      const fetchLangWatch = createLangWatchFetch({ fetch: fetchImpl, logger: silentLogger() });

      const error = await refusal(() => fetchLangWatch(HTTP_URL));

      expect(calls).toHaveLength(2);
      expect(error.url).toBe(HTTPS_URL);
      expect(error.location).toBe("https://app.langwatch.ai/api/traces/search/?limit=1");
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
        redirect(301, "https://app.langwatch.ai/api/annotations"),
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
