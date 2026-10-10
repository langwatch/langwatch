import http from "node:http";
import net from "node:net";
import path from "node:path";

import { build } from "vite";

import type { PortForwarder } from "./backend.process.ts";

/**
 * The haven orb on a built-UI stack (ADR-064, 2026-10-10; specs/setup/haven-dev-orb.feature).
 * Vite injects it on dev pages; here the api's port injects it into the built shell. This
 * package is in no image, so production never serves it.
 */
export const ORB_PATH = "/__haven/orb/";

/** The orb's built files by name, and the one the page loads. */
export type OrbBuild = Readonly<{ entry: string; files: ReadonlyMap<string, string | Uint8Array> }>;

/** Only haven's built-UI lane: a dev:one stack's Vite server injects the orb itself. */
export function servesOrb({ withUi, slug }: { withUi: boolean; slug: string | undefined }) {
  return !withUi && Boolean(slug);
}

/** The orb's module script at the end of the head, as the Vite plugin places it. */
export function injectOrb({ html, entry }: { html: string; entry: string }): string {
  return html.replace(/<\/head>/iu, `<script type="module" src="${ORB_PATH}${entry}"></script>$&`);
}

/** Marks a page a `haven up --watch` stack served; browser-host reloads it once idle after a swap. */
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

/** A page answer, read whole and sent on with the orb's script in its head. */
function answerPage({
  orb,
  isUiWatch,
  answer,
  response,
}: {
  orb: Orb;
  isUiWatch: boolean;
  answer: http.IncomingMessage;
  response: http.ServerResponse;
}) {
  const chunks: Buffer[] = [];
  answer.on("data", (chunk: Buffer) => chunks.push(chunk));
  answer.on("end", () => {
    void orb().then((built) => {
      const html = Buffer.concat(chunks).toString("utf8");
      const withOrb = built ? injectOrb({ html, entry: built.entry }) : html;
      const body = isUiWatch ? withOrb.replace(/<\/head>/iu, `${UI_WATCH_META}$&`) : withOrb;
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

/**
 * forwardPort over HTTP: the same stable port moved between generations, but a page answer gets
 * the orb's script and ORB_PATH answers from the orb's build, asked for on first use.
 */
export async function forwardPortWithOrb({
  port,
  orb,
  isUiWatch = false,
}: {
  port: number;
  orb: Orb;
  isUiWatch?: boolean;
}): Promise<PortForwarder> {
  let target: number | undefined;
  const agent = new http.Agent({ keepAlive: true });

  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith(ORB_PATH)) return void serveOrb({ orb, url, response });
    if (target === undefined) return void request.socket.destroy();
    const options = {
      host: "127.0.0.1",
      port: target,
      method: request.method,
      path: url,
      headers: request.headers,
      agent,
    };
    const upstream = http.request(options, (answer) => {
      if (isPage(answer)) return answerPage({ orb, isUiWatch, answer, response });
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    upstream.on("error", () => response.destroy());
    response.on("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
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
    close: () =>
      new Promise<void>((resolve) => {
        agent.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
