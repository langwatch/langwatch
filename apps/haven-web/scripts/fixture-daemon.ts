/**
 * A stand-in for the haven daemon: the built bundle plus the fixture JSON, on
 * a loopback port. `*.langwatch.localhost` resolves to loopback in Chromium,
 * so a home is `http://feat-x.langwatch.localhost:<port>/`.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

import { hub, liveHome, logs, notFound, stoppedHome } from "../src/__fixtures__/daemon.ts";
import { nowMs } from "../src/shared/clock.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const json = ({
  response,
  status,
  body,
}: {
  response: ServerResponse;
  status: number;
  body: unknown;
}) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

const answerApi = ({
  url,
  method,
  response,
}: {
  url: URL;
  method: string;
  response: ServerResponse;
}) => {
  const now = nowMs();
  const path = url.pathname;
  if (path === "/api/hub") return json({ response, status: 200, body: hub({ now }) });
  if (path === "/api/logs") {
    return json({
      response,
      status: 200,
      body: logs({ now, lane: url.searchParams.get("service") ?? "" }),
    });
  }
  if (method === "POST" && path.endsWith("/restart")) {
    return json({ response, status: 200, body: { message: "restarted feat-x" } });
  }
  if (method === "POST" && path.endsWith("/api-key")) {
    return json({ response, status: 200, body: { apiKey: "sk-lw-fixture-not-a-secret-9f3a" } });
  }
  if (method === "POST" && path === "/api/worktrees/start") {
    return json({ response, status: 200, body: { message: "starting stopped" } });
  }
  const slug = /^\/api\/stacks\/([^/]+)$/.exec(path)?.[1];
  if (slug === "feat-x") return json({ response, status: 200, body: liveHome({ now }) });
  if (slug === "stopped") return json({ response, status: 200, body: stoppedHome({ now }) });
  return json({ response, status: 404, body: notFound({ slug: slug ?? "" }) });
};

const serveFile = async ({
  dist,
  path,
  response,
}: {
  dist: string;
  path: string;
  response: ServerResponse;
}) => {
  const wanted = normalize(join(dist, path));
  const file =
    wanted.startsWith(dist) && extname(wanted) !== "" ? wanted : join(dist, "index.html");
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
};

export const startFixtureDaemon = async ({ dist }: { dist: string }) => {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://fixture");
    if (url.pathname.startsWith("/api/")) {
      answerApi({ url, method: request.method ?? "GET", response });
      return;
    }
    void serveFile({ dist, path: url.pathname, response });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
};
