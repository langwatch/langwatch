import http from "node:http";
import net from "node:net";
import path from "node:path";

import { build } from "vite";

import type { PortForwarder } from "./backend.process.ts";
import {
  failureBody,
  failurePage,
  injectBanner,
  retryInSeconds,
  type BootFailure,
} from "./boot-failure.ts";

/**
 * The haven orb on a built-UI stack (ADR-064, 2026-10-10; specs/setup/haven-dev-orb.feature).
 * Vite injects it on dev pages; here the api's port injects it into the built shell. This
 * package is in no image, so production never serves it.
 */
export const ORB_PATH = "/__haven/orb/";

/** The orb's built files by name, and the one the page loads. */
export type OrbBuild = Readonly<{ entry: string; files: ReadonlyMap<string, string | Uint8Array> }>;

/** The backend serves the orb on any haven stack; under --hmr the Vite ui lane injects its own. */
export function servesOrb({ slug }: { slug: string | undefined }) {
  return Boolean(slug);
}

/** The orb's module script at the end of the head, as the Vite plugin places it. */
export function injectOrb({ html, entry }: { html: string; entry: string }): string {
  return html.replace(/<\/head>/iu, `<script type="module" src="${ORB_PATH}${entry}"></script>$&`);
}

/**
 * Marks a page a `haven up --watch` stack served; browser-host reloads it once idle after a swap.
 */
export const UI_WATCH_META = '<meta name="haven-ui-watch" content="1">';

/** Builds apps/ui/vite/haven-orb.config.ts in memory; undefined when it cannot. */
export async function buildOrb({ uiRoot }: { uiRoot: string }): Promise<OrbBuild | undefined> {
  const result = await build({
    configFile: path.join(uiRoot, "vite/haven-orb.config.ts"),
    configLoader: "runner",
  });
  if (!Array.isArray(result) && !("output" in result)) return undefined;
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output);
  const entry = outputs.find((file) => file.type === "chunk" && file.isEntry)?.fileName;
  if (!entry) return undefined;
  const files = new Map(
    outputs.map((file) => [file.fileName, file.type === "chunk" ? file.code : file.source]),
  );
  return { entry, files };
}

const isPage = (answer: http.IncomingMessage): boolean =>
  answer.statusCode === 200 &&
  /^text\/html/iu.test(answer.headers["content-type"] ?? "") &&
  !answer.headers["content-encoding"];

type Orb = () => Promise<OrbBuild | undefined>;

async function serveOrb({
  orb,
  url,
  response,
}: {
  orb: Orb;
  url: string;
  response: http.ServerResponse;
}) {
  const built = await orb();
  const body = built?.files.get(url.slice(ORB_PATH.length).split("?")[0] ?? "");
  if (body === undefined) return void response.writeHead(404).end();
  response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
  response.end(body);
}

/** A page answer, read whole and sent on with the orb's script and any boot failure's banner. */
function answerPage({
  orb,
  isUiWatch,
  failure,
  answer,
  response,
}: {
  orb: Orb | undefined;
  isUiWatch: boolean;
  failure: BootFailure | undefined;
  answer: http.IncomingMessage;
  response: http.ServerResponse;
}) {
  const chunks: Buffer[] = [];
  answer.on("data", (chunk: Buffer) => chunks.push(chunk));
  answer.on("end", () => {
    void (orb?.() ?? Promise.resolve(undefined)).then((built) => {
      const html = Buffer.concat(chunks).toString("utf8");
      const withOrb = built ? injectOrb({ html, entry: built.entry }) : html;
      const watched = isUiWatch ? withOrb.replace(/<\/head>/iu, `${UI_WATCH_META}$&`) : withOrb;
      const body = failure ? injectBanner({ html: watched, failure, now: Date.now() }) : watched;
      const {
        "content-length": _,
        "transfer-encoding": __,
        etag: ___,
        ...headers
      } = answer.headers;
      response.writeHead(200, { ...headers, "content-length": Buffer.byteLength(body) });
      response.end(body);
    });
  });
}

/** Replays an upgrade's head upstream and tunnels the bytes; either side ending ends both. */
function tunnel({
  target,
  request,
  client,
  head,
}: {
  target: number;
  request: http.IncomingMessage;
  client: net.Socket;
  head: Buffer;
}) {
  const upstream = net.connect(target, "127.0.0.1", () => {
    const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
  const end = (): void => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", end).on("end", end).on("close", end);
  upstream.on("error", end).on("end", end).on("close", end);
}

/** While no api serves: a browser gets the plain 503 page, anything else the JSON 503. */
function answerFailure({
  failure,
  request,
  response,
}: {
  failure: BootFailure;
  request: http.IncomingMessage;
  response: http.ServerResponse;
}) {
  const now = Date.now();
  const isPage = request.method === "GET" && /text\/html/iu.test(request.headers.accept ?? "");
  const body = isPage
    ? failurePage({ failure, now })
    : JSON.stringify(failureBody({ failure, now }));
  response.writeHead(503, {
    "content-type": isPage ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    "retry-after": String(retryInSeconds({ failure, now })),
  });
  response.end(body);
}

/** One request sent on to the serving api; a page answer goes through `answerPage`. */
function proxy({
  target,
  agent,
  page,
  request,
  response,
}: {
  target: number;
  agent: http.Agent;
  page: { orb: Orb | undefined; isUiWatch: boolean; failure: BootFailure | undefined };
  request: http.IncomingMessage;
  response: http.ServerResponse;
}) {
  const options = {
    host: "127.0.0.1",
    port: target,
    method: request.method,
    path: request.url ?? "/",
    headers: request.headers,
    agent,
  };
  const upstream = http.request(options, (answer) => {
    if (isPage(answer)) return answerPage({ ...page, answer, response });
    response.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(response);
  });
  upstream.on("error", () => response.destroy());
  response.on("close", () => {
    if (!response.writableFinished) upstream.destroy();
  });
  request.pipe(upstream);
}

/**
 * The api's stable port over HTTP, moved between generations. A page answer gets the orb's script
 * (when given) and a reported boot failure's banner; with no api routed, a reported failure
 * answers 503. ORB_PATH answers from the orb's build, asked for on first use.
 */
export async function forwardPortWithOrb({
  port,
  orb,
  isUiWatch = false,
}: {
  port: number;
  orb?: Orb;
  isUiWatch?: boolean;
}): Promise<PortForwarder> {
  let target: number | undefined;
  let failure: BootFailure | undefined;
  const agent = new http.Agent({ keepAlive: true });

  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (orb && url.startsWith(ORB_PATH)) return void serveOrb({ orb, url, response });
    if (target === undefined) {
      if (failure) return answerFailure({ failure, request, response });
      return void request.socket.destroy();
    }
    proxy({ target, agent, page: { orb, isUiWatch, failure }, request, response });
  });
  server.on("upgrade", (request: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    if (target === undefined) return void client.destroy();
    tunnel({ target, request, client, head });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  return {
    route(next) {
      target = next;
    },
    report(next) {
      failure = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        agent.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
