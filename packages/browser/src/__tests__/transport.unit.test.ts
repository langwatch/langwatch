import { describe, expect, it } from "vitest";

import { createUiFeatureApiClient, type UiFeatureApiClientOptions } from "../transport.ts";

function requestUrl(input: RequestInfo | URL | undefined): string {
  if (input === undefined) return "";
  return input instanceof Request ? input.url : input.toString();
}

type Call = { url: string; method: string };

function transportOver(
  bodies: unknown[],
  options: Omit<UiFeatureApiClientOptions, "fetch"> = {},
): {
  client: ReturnType<typeof createUiFeatureApiClient>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queue = [...bodies];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: requestUrl(input), method: init?.method ?? "GET" });
    const body = queue.shift();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return { client: createUiFeatureApiClient({ fetch, ...options }), calls };
}

/** One tRPC result, in the shape JSON transport sends back. */
function resultOf(data: unknown): unknown {
  return { result: { data: data } };
}

describe("given the browser transport a feature package's hooks run on", () => {
  describe("when a feature queries a procedure", () => {
    it("sends it to the same-origin platform API and decodes the answer", async () => {
      const { client, calls } = transportOver([resultOf({ id: "prompt_1" })]);

      const output = await client.query("prompts.getById", { id: "prompt_1" });

      expect(output).toEqual({ id: "prompt_1" });
      expect(calls[0]?.url.startsWith("/api/trpc/prompts.getById")).toBe(true);
    });

    it("sends each call as its own request, with no batch parameter", async () => {
      const { client, calls } = transportOver([resultOf("a"), resultOf("b")]);

      const outputs = await Promise.all([
        client.query("prompts.getById", { id: "a" }),
        client.query("prompts.getAll", { projectId: "p" }),
      ]);

      expect(outputs).toEqual(["a", "b"]);
      expect(calls).toHaveLength(2);
      expect(calls.some((call) => call.url.includes("batch="))).toBe(false);
    });
  });

  describe("when a feature mutates", () => {
    it("posts to the same endpoint", async () => {
      const { client, calls } = transportOver([resultOf({ id: "prompt_2" })]);

      await client.mutation("prompts.create", { name: "New" });

      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.url.startsWith("/api/trpc/prompts.create")).toBe(true);
    });
  });

  describe("when the platform API answers with an error", () => {
    it("surfaces it to the caller rather than resolving with nothing", async () => {
      const { client } = transportOver([
        { error: { message: "not_found", code: -32004, data: {} } },
      ]);

      await expect(client.query("prompts.getById", { id: "missing" })).rejects.toThrow("not_found");
    });
  });
});

describe("when a feature sends an answer on its way out of the document", () => {
  it("keeps the request alive past navigation and sends the other call on its own", async () => {
    const inits: RequestInit[] = [];
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(input instanceof Request ? input.url : input.toString());
      inits.push(init ?? {});
      const answer = inits.length === 1 ? "kept" : "other";
      return new Response(JSON.stringify(resultOf(answer)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
    const client = createUiFeatureApiClient({ fetch });
    const outputs = await Promise.all([
      client.mutation("onboarding.dismiss", { id: "n" }, { context: { keepalive: true } }),
      client.query("prompts.getAll", { projectId: "p" }),
    ]);
    expect(outputs).toEqual(["kept", "other"]);
    expect(inits[0]?.keepalive).toBe(true);
    expect(urls[0]).not.toContain("batch=1");
    expect(inits[1]?.keepalive).toBeUndefined();
  });
});
