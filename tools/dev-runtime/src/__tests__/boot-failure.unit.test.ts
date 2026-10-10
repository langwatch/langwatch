import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { freeLoopbackPort, type PortForwarder } from "../backend.process.ts";
import { bootFailureOf, LOGS_COMMAND } from "../boot-failure.ts";
import { forwardPortWithOrb } from "../haven-orb.ts";

const SHELL = "<!doctype html><html><head></head><body><div id=root></div></body></html>";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function forwarder(): Promise<{ port: number; forwarder: PortForwarder }> {
  const port = await freeLoopbackPort();
  const forwarded = await forwardPortWithOrb({ port });
  closers.push(() => forwarded.close());
  return { port, forwarder: forwarded };
}

async function shellOn(port: number): Promise<void> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(SHELL);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  closers.push(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
}

const get = ({
  port,
  path,
  accept,
}: {
  port: number;
  path: string;
  accept: string;
}): Promise<{ status: number; type?: string; body: string }> =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, agent: false, headers: { accept } }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            type: response.headers["content-type"],
            body,
          }),
        );
      })
      .on("error", reject);
  });

const failure = (half: "api" | "worker") => {
  const error = new TypeError("Cannot read properties of undefined (reading 'register')");
  return bootFailureOf({ half, error, retryAt: Date.now() + 5_000 });
};

describe("given the api's port while the backend is not whole", () => {
  describe("when no api serves and a boot failure was reported", () => {
    /** @scenario "A backend that cannot serve answers every request with why" */
    it("answers a page request with a 503 page naming the half, the error and the retry", async () => {
      const { port, forwarder: forwarded } = await forwarder();
      forwarded.report(failure("api"));

      const page = await get({ port, path: "/projects/demo", accept: "text/html" });

      expect(page.status).toBe(503);
      expect(page.type).toMatch(/^text\/html/);
      expect(page.body).toContain("API failed to boot");
      expect(page.body).toContain("reading &#39;register&#39;");
      expect(page.body).toContain("TypeError");
      expect(page.body).toMatch(/Retrying in [45]s/);
      expect(page.body).toContain(LOGS_COMMAND);
    });

    /** @scenario "A backend that cannot serve answers every request with why" */
    it("answers an API request with a JSON 503 carrying the same fields", async () => {
      const { port, forwarder: forwarded } = await forwarder();
      forwarded.report(failure("api"));

      const answer = await get({ port, path: "/api/health", accept: "application/json" });

      expect(answer.status).toBe(503);
      expect(JSON.parse(answer.body)).toMatchObject({
        error: "backend_unavailable",
        half: "api",
        message: "Cannot read properties of undefined (reading 'register')",
        stack: expect.stringContaining("TypeError"),
        retryInSeconds: expect.any(Number),
        logs: LOGS_COMMAND,
      });
    });
  });

  describe("when the api serves but the worker failed to boot", () => {
    /** @scenario "A worker that fails to boot never takes the api down" */
    it("serves every page with a banner, and drops it once a retry succeeds", async () => {
      const { port, forwarder: forwarded } = await forwarder();
      const api = await freeLoopbackPort();
      await shellOn(api);
      forwarded.route(api);
      forwarded.report(failure("worker"));

      const page = await get({ port, path: "/", accept: "text/html" });
      expect(page.status).toBe(200);
      expect(page.body).toContain('<div id=root></div><div role="alert"');
      expect(page.body).toMatch(/Worker failed to boot: .*jobs are not running; retrying in [45]s/);

      forwarded.report(undefined);
      expect((await get({ port, path: "/", accept: "text/html" })).body).toBe(SHELL);
    });
  });
});
