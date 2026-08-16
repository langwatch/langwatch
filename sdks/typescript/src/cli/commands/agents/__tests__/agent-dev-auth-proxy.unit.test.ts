import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startAuthProxy } from "../dev/auth-proxy";
import { DEV_SECRET_HEADER } from "../dev/write-back";

describe("startAuthProxy()", () => {
  let target: http.Server;
  let targetPort: number;
  let received: {
    path?: string;
    secretHeader?: string | string[];
    headers?: http.IncomingHttpHeaders;
  }[];

  beforeEach(async () => {
    received = [];
    target = http.createServer((req, res) => {
      received.push({
        path: req.url,
        secretHeader: req.headers[DEV_SECRET_HEADER.toLowerCase()],
        headers: req.headers,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    targetPort = (target.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  describe("when a request arrives without the session secret", () => {
    /** @scenario "The auth proxy rejects requests without the session secret" */
    it("rejects it with 401 and forwards requests that carry the secret", async () => {
      const proxy = await startAuthProxy({
        targetUrl: `http://127.0.0.1:${targetPort}/agent/chat`,
        secret: "session-secret",
      });

      const rejected = await fetch(proxy.url, { method: "POST" });
      expect(rejected.status).toBe(401);
      expect(received).toHaveLength(0);

      const accepted = await fetch(proxy.url, {
        method: "POST",
        headers: { [DEV_SECRET_HEADER]: "session-secret" },
        body: JSON.stringify({ message: "hi" }),
      });
      expect(accepted.status).toBe(200);
      expect(received).toHaveLength(1);
      // Forwarded onto the target URL's own path, with the transport-auth
      // header stripped before it reaches the local agent.
      expect(received[0]?.path).toBe("/agent/chat");
      expect(received[0]?.secretHeader).toBeUndefined();

      const wrongSecret = await fetch(proxy.url, {
        method: "POST",
        headers: { [DEV_SECRET_HEADER]: "some-other-secret" },
      });
      expect(wrongSecret.status).toBe(401);

      await proxy.close();
    });
  });

  describe("when a request carries hop-by-hop headers", () => {
    it("does not forward them to the local agent", async () => {
      const proxy = await startAuthProxy({
        targetUrl: `http://127.0.0.1:${targetPort}/agent/chat`,
        secret: "session-secret",
      });

      // Raw http.request: fetch refuses to send these headers at all.
      await new Promise<void>((resolve, reject) => {
        const request = http.request(
          `${proxy.url}/agent/chat`,
          {
            method: "POST",
            headers: {
              [DEV_SECRET_HEADER]: "session-secret",
              "proxy-authorization": "Basic abc",
              "keep-alive": "timeout=5",
              trailer: "Expires",
            },
          },
          (response) => {
            response.resume();
            response.on("end", resolve);
          },
        );
        request.on("error", reject);
        request.end();
      });

      expect(received).toHaveLength(1);
      const forwarded = received[0]?.headers ?? {};
      expect(forwarded["proxy-authorization"]).toBeUndefined();
      expect(forwarded["keep-alive"]).toBeUndefined();
      expect(forwarded.trailer).toBeUndefined();

      await proxy.close();
    });
  });

  describe("when the local agent accepts the connection but never answers", () => {
    it("answers 502 after the upstream timeout instead of holding the socket", async () => {
      const silent = http.createServer(() => {
        // Never respond: the proxy's upstream timeout has to break the wait.
      });
      await new Promise<void>((resolve) =>
        silent.listen(0, "127.0.0.1", resolve),
      );
      const silentPort = (silent.address() as { port: number }).port;

      const proxy = await startAuthProxy({
        targetUrl: `http://127.0.0.1:${silentPort}/agent/chat`,
        secret: "session-secret",
        upstreamTimeoutMs: 100,
      });

      const response = await fetch(proxy.url, {
        method: "POST",
        headers: { [DEV_SECRET_HEADER]: "session-secret" },
      });
      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("did not answer within");

      await proxy.close();
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    });
  });

  describe("when the local agent dies mid-response", () => {
    it("ends the client response instead of appending an error body", async () => {
      const flaky = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"partial":');
        // Flush the headers and first chunk before dying, so the failure
        // lands mid-response rather than before the response starts.
        setTimeout(() => res.destroy(), 30);
      });
      await new Promise<void>((resolve) =>
        flaky.listen(0, "127.0.0.1", resolve),
      );
      const flakyPort = (flaky.address() as { port: number }).port;

      const proxy = await startAuthProxy({
        targetUrl: `http://127.0.0.1:${flakyPort}/agent/chat`,
        secret: "session-secret",
      });

      const response = await fetch(proxy.url, {
        method: "POST",
        headers: { [DEV_SECRET_HEADER]: "session-secret" },
      });
      expect(response.status).toBe(200);
      // The body the client was parsing is cut off, not extended with a JSON
      // error blob it would misparse as agent output.
      await expect(response.text()).rejects.toThrow();

      await proxy.close();
      await new Promise<void>((resolve) => flaky.close(() => resolve()));
    });
  });
});
