import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LangWatch } from "@/client-sdk";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const initResponse = (): Response =>
  new Response(
    JSON.stringify({
      slug: "trailing-slash-eval",
      path: "/acme/experiments/trailing-slash-eval",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const fetchedUrl = (): string => {
  const request = mockFetch.mock.calls[0]![0];
  return request instanceof Request ? request.url : String(request);
};

/**
 * A trailing slash on the endpoint used to append onto paths that already carry
 * their own leading slash, producing `//api/experiment/init`. The router does
 * not match that, so the SDK surfaced the server's opaque `{"error":"Not
 * Found"}` with nothing pointing at the endpoint as the cause.
 */
describe("Experiment.init endpoint handling", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(initResponse());
    // Left unset so ensureSetup() stays a no-op; the key is passed explicitly.
    delete process.env.LANGWATCH_API_KEY;
    delete process.env.LANGWATCH_ENDPOINT;
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
    if (previousEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = previousEndpoint;
  });

  describe("given an endpoint configured with a trailing slash", () => {
    describe("when an experiment is initialized", () => {
      /** @scenario A trailing slash on the configured endpoint still reaches the API */
      it("requests the init path without a double slash", async () => {
        const langwatch = new LangWatch({
          apiKey: "sk-lw-test",
          endpoint: "https://app.langwatch.ai/",
        });

        await langwatch.experiments.init("trailing-slash-eval");

        expect(fetchedUrl()).toBe("https://app.langwatch.ai/api/experiment/init");
        expect(new URL(fetchedUrl()).pathname).toBe("/api/experiment/init");
      });
    });
  });

  describe("given repeated trailing slashes on a self-hosted endpoint", () => {
    describe("when an experiment is initialized", () => {
      /** @scenario Repeated trailing slashes are normalized */
      it("collapses them to a single path separator", async () => {
        const langwatch = new LangWatch({
          apiKey: "sk-lw-test",
          endpoint: "http://localhost:5560///",
        });

        await langwatch.experiments.init("trailing-slash-eval");

        expect(fetchedUrl()).toBe("http://localhost:5560/api/experiment/init");
      });
    });
  });

  describe("given LANGWATCH_ENDPOINT carries the trailing slash", () => {
    describe("when an experiment is initialized without an explicit endpoint", () => {
      /** @scenario A trailing slash in the environment endpoint is normalized */
      it("requests the init path without a double slash", async () => {
        process.env.LANGWATCH_ENDPOINT = "https://app.langwatch.ai/";

        const langwatch = new LangWatch({ apiKey: "sk-lw-test" });

        await langwatch.experiments.init("trailing-slash-eval");

        expect(fetchedUrl()).toBe("https://app.langwatch.ai/api/experiment/init");
      });
    });
  });
});
