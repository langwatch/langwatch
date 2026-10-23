/**
 * @vitest-environment node
 * @see specs/npx-installer/09-prebuilt-app.feature
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BOOT_EVENTS_PATH, openBootDoor, type BootDoor } from "../../src/services/boot-door.ts";

const doors: BootDoor[] = [];
const scratch: string[] = [];
const backends: http.Server[] = [];

afterEach(async () => {
  await Promise.all(doors.splice(0).map((door) => door.close()));
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const backend of backends.splice(0)) {
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  }
});

/** A stand-in backend on loopback that names itself in every answer. */
async function startBackend(): Promise<number> {
  const backend = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" }).end(`backend saw ${req.headers.host}`);
  });
  backends.push(backend);
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  return (backend.address() as AddressInfo).port;
}

async function openDoor(): Promise<BootDoor> {
  const door = await openBootDoor({
    port: 0,
    backendPort: await startBackend(),
    report: () => undefined,
  });
  doors.push(door);
  return door;
}

const urlOf = (door: BootDoor, path: string) => `http://127.0.0.1:${door.port}${path}`;

/** Opens the boot page's event stream; `until` reads it until a pattern has arrived. */
async function openEvents({ door }: { door: BootDoor }) {
  const response = await fetch(urlOf(door, BOOT_EVENTS_PATH));
  if (!response.body) throw new Error("the boot page answered no event stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  return {
    until: async (pattern: RegExp): Promise<string> => {
      while (!pattern.test(received)) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
      }
      await reader.cancel();
      return received;
    },
  };
}

describe("the boot page on the public port", () => {
  describe("when the browser opens before the backend is up", () => {
    /** @scenario "The browser opens on a boot page at once" */
    it("answers a page with the plain console look, and a plain 503 to API callers", async () => {
      const door = await openDoor();

      const page = await fetch(urlOf(door, "/"), { headers: { Accept: "text/html" } });
      const api = await fetch(urlOf(door, "/api/traces"), {
        headers: { Accept: "application/json" },
      });

      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<h1>Starting LangWatch</h1>");
      expect(api.status).toBe(503);
      expect(api.headers.get("retry-after")).toBe("5");
    });

    /** @scenario "The boot page shows each service's state" */
    it("streams each service's state as the CLI's events arrive", async () => {
      const door = await openDoor();
      door.feed({ type: "starting", service: "postgres" });
      door.feed({ type: "healthy", service: "postgres", durationMs: 10 });
      door.feed({ type: "log", service: "postgres", stream: "stdout", line: "ignored" });
      door.feed({ type: "starting", service: "langwatch" });

      const events = await (await openEvents({ door })).until(/langwatch/);

      expect(events).toContain('"service":"postgres","state":"ready"');
      expect(events).toContain('"service":"langwatch","state":"starting"');
      expect(events).not.toContain("ignored");
    });
  });

  describe("when the backend becomes healthy", () => {
    /** @scenario "Ready means the backend is healthy, and the page reloads into the app" */
    it("tells open pages to reload and forwards the public port to the backend, Host kept", async () => {
      const door = await openDoor();
      const events = await openEvents({ door });

      await door.openApp();

      expect(await events.until(/event: ready/)).toContain("event: ready");
      const response = await fetch(urlOf(door, "/settings"), { headers: { Accept: "text/html" } });
      expect(await response.text()).toBe(`backend saw 127.0.0.1:${door.port}`);
    });

    /** @scenario "The health check on the public port reports the backend once it is up" */
    it("answers /healthz itself while booting and from the backend after the switch", async () => {
      const door = await openDoor();
      const booting = await fetch(urlOf(door, "/healthz"));

      await door.openApp();
      const open = await fetch(urlOf(door, "/healthz"));

      expect(await booting.text()).toBe("ok");
      expect(await open.text()).toBe(`backend saw 127.0.0.1:${door.port}`);
    });
  });

  describe("when the backend fails its first boot", () => {
    /** @scenario "A failed first boot shows on the boot page with the log path" */
    it("streams the failure and where the logs are", async () => {
      const door = await openDoor();
      door.fail({
        reason: "langwatch did not become healthy",
        logsDir: "/home/me/.langwatch/logs",
      });

      const events = await (await openEvents({ door })).until(/event: failed/);

      expect(events).toContain("event: failed");
      expect(events).toContain("langwatch did not become healthy");
      expect(events).toContain("/home/me/.langwatch/logs");
    });
  });
});

/** A built browser bundle: an index.html naming its entry script and styles, and those files. */
function builtClient(): string {
  const clientDir = mkdtempSync(join(tmpdir(), "lw-ui-client-"));
  scratch.push(clientDir);
  mkdirSync(join(clientDir, "assets"));
  writeFileSync(
    join(clientDir, "index.html"),
    '<script type="module" crossorigin src="/assets/core-abc.js"></script>' +
      '<link rel="stylesheet" crossorigin href="/assets/core-def.css">',
  );
  writeFileSync(join(clientDir, "assets", "core-abc.js"), "export {};");
  writeFileSync(join(clientDir, "assets", "core-def.css"), "body{}");
  return clientDir;
}

describe("the app's assets on the boot page", () => {
  describe("when the app is unpacked before the backend is up", () => {
    /** @scenario "The app's assets load while the backend is still starting" */
    it("serves the hashed assets cached for good and tells open pages to fetch the entries", async () => {
      const door = await openDoor();
      const before = await fetch(urlOf(door, "/assets/core-abc.js"));
      const events = await openEvents({ door });

      door.offerAssets({ clientDir: builtClient() });
      const asset = await fetch(urlOf(door, "/assets/core-abc.js"));

      expect(before.status).toBe(503);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(asset.headers.get("content-type")).toBe("application/javascript");
      expect(await asset.text()).toBe("export {};");
      expect(await events.until(/event: assets/)).toContain(
        '["/assets/core-abc.js","/assets/core-def.css"]',
      );
    });
  });

  describe("when the page asks for the app's index", () => {
    /** @scenario "The app's assets load while the backend is still starting" */
    it("still answers the boot page: the index stays the api's", async () => {
      const door = await openDoor();
      door.offerAssets({ clientDir: builtClient() });

      const page = await fetch(urlOf(door, "/index.html"), { headers: { Accept: "text/html" } });

      expect(await page.text()).toContain("<h1>Starting LangWatch</h1>");
    });
  });
});

/** A GET with its path sent as written: fetch would resolve the `..` before it left. */
function rawGet({ door, path }: { door: BootDoor; path: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: door.port, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
  });
}

describe("a request for a path outside the app's assets", () => {
  describe("when the path climbs out of the assets directory", () => {
    /** @scenario "The boot page serves no file outside the app's assets" */
    it("serves no file for it", async () => {
      const door = await openDoor();
      const clientDir = builtClient();
      writeFileSync(join(clientDir, "secret.txt"), "not for the network");
      door.offerAssets({ clientDir });

      for (const path of ["/assets/../secret.txt", "/assets/../../../etc/passwd"]) {
        const answer = await rawGet({ door, path });

        expect(answer.status).toBe(503);
        expect(answer.body).toBe("LangWatch is starting");
      }
    });
  });

  describe("when the path cannot be read as a file", () => {
    /** @scenario "The boot page serves no file outside the app's assets" */
    it("answers as for any other path and keeps the port up", async () => {
      const door = await openDoor();
      door.offerAssets({ clientDir: builtClient() });

      const underAFile = await rawGet({ door, path: "/assets/core-abc.js/inside" });
      const asset = await fetch(urlOf(door, "/assets/core-abc.js"));

      expect(underAFile.status).toBe(503);
      expect(asset.status).toBe(200);
    });
  });
});
