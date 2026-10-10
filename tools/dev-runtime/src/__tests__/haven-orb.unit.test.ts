import http from "node:http";
import type net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { freeLoopbackPort, type PortForwarder } from "../backend.process.ts";
import {
  forwardPortWithOrb,
  ORB_PATH,
  servesOrb,
  UI_WATCH_META,
  type OrbBuild,
} from "../haven-orb.ts";

const SHELL = "<!doctype html><html><head><title>app</title></head><body></body></html>";
const ORB: OrbBuild = { entry: "orb.js", files: new Map([["orb.js", "/* orb */"]]) };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** A stand-in api: the shell for pages, JSON for /api, and an echoing upgrade. */
async function apiOn(port: number): Promise<void> {
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/")) {
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    response.writeHead(200, { "content-type": "text/html", etag: '"shell"' }).end(SHELL);
  });
  server.on("upgrade", (_request: http.IncomingMessage, socket: net.Socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n",
    );
    socket.on("data", (chunk: Buffer) => socket.write(chunk)).on("end", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  closers.push(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
}

async function stableWithOrb(orb: OrbBuild | undefined, isUiWatch = false): Promise<number> {
  const stable = await freeLoopbackPort();
  const forwarder: PortForwarder = await forwardPortWithOrb({
    port: stable,
    orb: async () => orb,
    isUiWatch,
  });
  closers.push(() => forwarder.close());
  const api = await freeLoopbackPort();
  await apiOn(api);
  forwarder.route(api);
  return stable;
}

const get = (
  port: number,
  path: string,
): Promise<{ status: number; body: string; etag?: string }> =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, agent: false }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body, etag: response.headers.etag }),
        );
      })
      .on("error", reject);
  });

describe("haven orb on a built-UI stack", () => {
  describe("given which lane the dev runtime runs", () => {
    /** @scenario "absent from a built-UI stack haven does not run" */
    it("serves the orb only on haven's built-UI lane", () => {
      expect(servesOrb({ withUi: false, slug: "feat-x" })).toBe(true);
      expect(servesOrb({ withUi: false, slug: undefined })).toBe(false);
      expect(servesOrb({ withUi: false, slug: "" })).toBe(false);
      // dev:one: the UI's Vite server injects the orb itself.
      expect(servesOrb({ withUi: true, slug: "feat-x" })).toBe(false);
    });
  });

  describe("given the api's port forwards to a generation", () => {
    /** @scenario "present on a built-UI stack haven runs" */
    it("adds the orb's script to the page's head and serves the orb", async () => {
      const port = await stableWithOrb(ORB);
      const page = await get(port, "/projects/demo");
      expect(page.body).toContain(`<script type="module" src="${ORB_PATH}orb.js"></script></head>`);
      expect(page.etag).toBeUndefined();
      expect(await get(port, `${ORB_PATH}orb.js`)).toMatchObject({
        status: 200,
        body: "/* orb */",
      });
      expect((await get(port, `${ORB_PATH}missing.js`)).status).toBe(404);
    });

    /** @scenario "present on a built-UI stack haven runs" */
    it("passes every other answer and upgrade through unchanged", async () => {
      const port = await stableWithOrb(ORB);
      expect((await get(port, "/api/health")).body).toBe('{"ok":true}');

      const echoed = await new Promise<string>((resolve, reject) => {
        http
          .request({
            host: "127.0.0.1",
            port,
            path: "/api/ws",
            headers: { Connection: "Upgrade", Upgrade: "echo" },
          })
          .on("upgrade", (_response, socket: net.Socket) => {
            socket.once("data", (chunk: Buffer) => {
              resolve(chunk.toString());
              socket.destroy();
            });
            socket.write("ping");
          })
          .on("error", reject)
          .end();
      });
      expect(echoed).toBe("ping");
    });

    /** @scenario "present on a built-UI stack haven runs" */
    it("serves the page as it is when the orb could not be built", async () => {
      const port = await stableWithOrb(undefined);
      expect((await get(port, "/")).body).toBe(SHELL);
    });
  });

  describe("given a --ui=watch stack's api port", () => {
    /** @scenario "A watch UI stack rebuilds the built UI on a change" */
    it("marks every page as a watch-mode page, orb or not", async () => {
      expect((await get(await stableWithOrb(undefined, true), "/")).body).toContain(
        `${UI_WATCH_META}</head>`,
      );
      expect((await get(await stableWithOrb(ORB), "/")).body).not.toContain(UI_WATCH_META);
    });
  });
});
