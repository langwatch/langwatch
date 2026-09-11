/**
 * The capture proxy against a real Ollama-shaped server. Real sockets, not a
 * mocked http module: a mock cannot tell you that a streamed token still
 * reaches the caller the moment the server produced it, and that is the one
 * property a proxy can quietly break.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OllamaSpanEmitter } from "../ollama-emitter";
import {
  DEFAULT_OLLAMA_ORIGIN,
  resolveUpstreamOrigin,
  startOllamaCaptureProxy,
  type OllamaCaptureProxy,
} from "../ollama-proxy";
import type { OtlpSpan } from "../ollama-trace";

/** An emitter that keeps every span so the test can read it. */
function recordingEmitter(): OllamaSpanEmitter & { spans: OtlpSpan[] } {
  const spans: OtlpSpan[] = [];
  return {
    spans,
    add: (span) => spans.push(span),
    flush: async () => undefined,
    close: async () => undefined,
    sent: () => spans.length,
  };
}

function attributes(span: OtlpSpan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attribute of span.attributes) out[attribute.key] = Object.values(attribute.value)[0];
  return out;
}

/** Requests the fake Ollama server saw, in order. */
interface SeenRequest {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("given a capture proxy in front of an ollama server", () => {
  let upstream: Server;
  let upstreamOrigin: string;
  let proxy: OllamaCaptureProxy;
  let emitter: ReturnType<typeof recordingEmitter>;
  let seen: SeenRequest[];
  /** Set per test to decide what the fake server answers. */
  let respond: (request: SeenRequest, res: ServerResponse) => void;

  beforeEach(async () => {
    seen = [];
    emitter = recordingEmitter();
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const request: SeenRequest = {
          method: req.method ?? "",
          url: req.url ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
          headers: req.headers,
        };
        seen.push(request);
        respond(request, res);
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamOrigin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    proxy = await startOllamaCaptureProxy({ upstreamOrigin, emitter });
  });

  afterEach(async () => {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  describe("when a chat request is answered in one piece", () => {
    /** @scenario "A chat call is reported as one LangWatch call" */
    it("returns the server's answer and reports one model call", async () => {
      respond = (_request, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "llama3",
            message: { role: "assistant", content: "blue light scatters" },
            done: true,
            prompt_eval_count: 9,
            eval_count: 4,
          }),
        );
      };

      const response = await fetch(`${proxy.url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "llama3",
          stream: false,
          messages: [{ role: "user", content: "why is the sky blue?" }],
        }),
      });
      const body = (await response.json()) as { message: { content: string } };

      expect(response.status).toBe(200);
      expect(body.message.content).toBe("blue light scatters");
      // The server saw the request the caller wrote, unchanged.
      expect(JSON.parse(seen[0]!.body)).toMatchObject({ model: "llama3" });

      expect(emitter.spans).toHaveLength(1);
      const read = attributes(emitter.spans[0]!);
      expect(read["langwatch.output"]).toBe("blue light scatters");
      expect(read["gen_ai.usage.input_tokens"]).toBe("9");
    });
  });

  describe("when a chat request is answered one chunk at a time", () => {
    /** @scenario "A streamed reply reaches the caller as it arrives" */
    it("passes each chunk through as it is produced and reports the whole reply", async () => {
      respond = (_request, res) => {
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write('{"model":"llama3","message":{"role":"assistant","content":"one "}}\n');
        setTimeout(() => {
          res.end(
            '{"model":"llama3","message":{"role":"assistant","content":"two"},"done":true,"eval_count":2}\n',
          );
        }, 120);
      };

      const startedAt = Date.now();
      const response = await fetch(`${proxy.url}/api/chat`, {
        method: "POST",
        body: JSON.stringify({ model: "llama3", messages: [{ role: "user", content: "count" }] }),
      });
      const reader = response.body!.getReader();
      const arrivals: number[] = [];
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arrivals.push(Date.now() - startedAt);
        text += Buffer.from(value).toString("utf8");
      }

      // The first chunk landed well before the server had finished: the proxy
      // is forwarding as it goes, not buffering the whole generation.
      expect(arrivals.length).toBeGreaterThan(1);
      expect(arrivals[0]!).toBeLessThan(100);
      expect(text).toContain("one ");
      expect(text).toContain("two");

      expect(emitter.spans).toHaveLength(1);
      expect(attributes(emitter.spans[0]!)["langwatch.output"]).toBe("one two");
    });
  });

  describe("when the request is one the proxy does not read", () => {
    /** @scenario "A request the proxy does not report still reaches the server untouched" */
    it("forwards it and reports nothing", async () => {
      respond = (_request, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "llama3" }] }));
      };

      const response = await fetch(`${proxy.url}/api/tags`);

      expect(await response.json()).toEqual({ models: [{ name: "llama3" }] });
      expect(seen[0]!.url).toBe("/api/tags");
      expect(emitter.spans).toEqual([]);
    });

    it("forwards a POST body it does not read", async () => {
      respond = (_request, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      };

      await fetch(`${proxy.url}/api/pull`, {
        method: "POST",
        body: JSON.stringify({ model: "llama3" }),
      });

      expect(JSON.parse(seen[0]!.body)).toEqual({ model: "llama3" });
      expect(emitter.spans).toEqual([]);
    });
  });

  describe("when the server rejects the request", () => {
    /** @scenario "A server error is returned to the caller and reported as a failed call" */
    it("returns the server's status and body, and reports a failed call", async () => {
      respond = (_request, res) => {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "model 'ghost' not found" }));
      };

      const response = await fetch(`${proxy.url}/api/chat`, {
        method: "POST",
        body: JSON.stringify({ model: "ghost", messages: [] }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "model 'ghost' not found" });
      expect(emitter.spans[0]!.status.code).toBe(2);
    });
  });

  describe("when the session makes no model calls", () => {
    /** @scenario "A session with no model calls reports nothing" */
    it("reports nothing", async () => {
      expect(emitter.spans).toEqual([]);
    });
  });
});

describe("when no ollama server is listening", () => {
  it("answers the caller with a message naming the address that did not answer", async () => {
    // Port 1 on loopback: reserved, never bound by anything a test can race.
    const upstreamOrigin = "http://127.0.0.1:1";
    const proxy = await startOllamaCaptureProxy({ upstreamOrigin, emitter: recordingEmitter() });
    try {
      const response = await fetch(`${proxy.url}/api/chat`, {
        method: "POST",
        body: JSON.stringify({ model: "llama3", messages: [] }),
      });
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(502);
      expect(body.error).toContain(upstreamOrigin);
    } finally {
      await proxy.close();
    }
  });
});

describe("reading OLLAMA_HOST", () => {
  /** @scenario "The proxy forwards to the address OLLAMA_HOST names" */
  it("takes a full URL as written", () => {
    expect(resolveUpstreamOrigin("http://192.168.1.9:11434")).toBe("http://192.168.1.9:11434");
    expect(resolveUpstreamOrigin("https://ollama.internal")).toBe("https://ollama.internal");
  });

  /** @scenario "An OLLAMA_HOST written without a scheme is understood" */
  it("adds the scheme to a host and port written without one", () => {
    expect(resolveUpstreamOrigin("127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
  });

  it("uses ollama's own default port for a bare host", () => {
    expect(resolveUpstreamOrigin("my-box")).toBe("http://my-box:11434");
  });

  /** @scenario "With OLLAMA_HOST unset the default local server is used" */
  it("falls back to the local server when it is unset, empty, or unreadable", () => {
    expect(resolveUpstreamOrigin(undefined)).toBe(DEFAULT_OLLAMA_ORIGIN);
    expect(resolveUpstreamOrigin("   ")).toBe(DEFAULT_OLLAMA_ORIGIN);
    expect(resolveUpstreamOrigin("http://")).toBe(DEFAULT_OLLAMA_ORIGIN);
  });
});

describe("the proxy's own lifetime", () => {
  it("stops answering once it is closed", async () => {
    const upstream = createServer((_req, res) => res.end("{}"));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startOllamaCaptureProxy({
      upstreamOrigin: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      emitter: recordingEmitter(),
    });
    const url = proxy.url;

    await proxy.close();
    await sleep(10);

    await expect(fetch(`${url}/api/tags`)).rejects.toThrow();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
});
