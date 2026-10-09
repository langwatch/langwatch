import http from "node:http";
import net, { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LIVENESS_PATH,
  renderUpgradeHoldingPage,
  UPGRADE_SIGN_IN_HREF,
  UPGRADING_PHASE,
  startHeartbeat,
  startLivenessThread,
  type Heartbeat,
  type LivenessThread,
} from "../liveness-thread.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const threads: LivenessThread[] = [];
const heartbeats: Heartbeat[] = [];
const listeners: http.Server[] = [];
const holding = { phase: "schema", outstandingStepIds: ["clickhouse:00042", "trace:fill-cost"] };

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  for (const heartbeat of heartbeats.splice(0)) heartbeat.stop();
  for (const listener of listeners.splice(0)) {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});

async function bootThread({
  onProxied,
  holdWindowMs = 20,
  maxParked,
}: {
  onProxied: () => void;
  holdWindowMs?: number;
  maxParked?: number;
}): Promise<LivenessThread> {
  const listener = http.createServer((_req, res) => {
    onProxied();
    res.writeHead(200, { "Content-Type": "text/plain" }).end("main");
  });
  listeners.push(listener);
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("no loopback port");
  const heartbeat = startHeartbeat({ intervalMs: 5 });
  heartbeats.push(heartbeat);
  const thread = await startLivenessThread({
    port: 0,
    heartbeat: heartbeat.buffer,
    proxyPort: address.port,
    logger,
    holdWindowMs,
    ...(maxParked === undefined ? {} : { maxParked }),
  });
  threads.push(thread);
  return thread;
}

const urlOf = ({ port }: AddressInfo, path: string): string => `http://127.0.0.1:${port}${path}`;

describe("the upgrade holding page", () => {
  describe("given the liveness thread is holding for an upgrade", () => {
    describe("when a browser asks for a page", () => {
      /** @scenario "A browser sees the holding page while an upgrade holds the door" */
      it("answers 503 with the phase and step ids, a retry header and no caching", async () => {
        const thread = await bootThread({ onProxied: () => {} });
        await thread.hold(holding);

        const response = await fetch(urlOf(thread.address, "/settings"), {
          headers: { Accept: "text/html,application/xhtml+xml" },
        });
        const body = await response.text();

        expect(response.status).toBe(503);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(response.headers.get("retry-after")).toBe("10");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toContain("LangWatch is upgrading");
        expect(body).toContain("schema");
        expect(body).toContain("clickhouse:00042");
        expect(body).toContain("trace:fill-cost");
      });
    });

    describe("when a JSON client calls an API path", () => {
      /** @scenario "An API caller keeps a plain 503 with a retry header while an upgrade holds the door" */
      it("answers a plain 503 and never reaches the main thread", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        await thread.hold(holding);

        const response = await fetch(urlOf(thread.address, "/api/traces"), {
          headers: { Accept: "application/json" },
        });

        expect(response.status).toBe(503);
        expect(response.headers.get("content-type")).toBe("text/plain");
        expect(response.headers.get("retry-after")).toBe("10");
        expect(await response.text()).not.toContain("clickhouse:00042");
        expect(onProxied).not.toHaveBeenCalled();
      });
    });

    describe("when a client asks to upgrade to a WebSocket", () => {
      /** @scenario "A WebSocket upgrade is refused while an upgrade holds the door" */
      it("answers 503 with a retry header and never reaches the main thread", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        await thread.hold(holding);

        const reply = await new Promise<string>((resolve, reject) => {
          const socket = net.connect({ host: "127.0.0.1", port: thread.address.port }, () =>
            socket.write(
              "GET /api/stream HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\n" +
                "Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\n" +
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
            ),
          );
          let received = "";
          socket.on("data", (chunk) => (received += chunk.toString()));
          socket.on("close", () => resolve(received));
          socket.on("error", reject);
        });

        expect(reply.startsWith("HTTP/1.1 503")).toBe(true);
        expect(reply).toContain("Retry-After: 10");
        expect(onProxied).not.toHaveBeenCalled();
      });
    });

    describe("when the kubelet probes liveness", () => {
      /** @scenario "Liveness still answers while an upgrade holds the door" */
      it("answers 200", async () => {
        const thread = await bootThread({ onProxied: () => {} });
        await thread.hold(holding);

        const response = await fetch(urlOf(thread.address, LIVENESS_PATH));

        expect(response.status).toBe(200);
      });
    });

    describe("when a request arrives and the hold lifts within the hold window", () => {
      /** @scenario "A held request waits for the hold to lift and then reaches the main thread" */
      it("parks the request and proxies it once the hold lifts", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied, holdWindowMs: 5_000 });
        await thread.hold(holding);

        const pending = fetch(urlOf(thread.address, "/api/otel/v1/traces"), {
          method: "POST",
          body: "spans",
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(onProxied).not.toHaveBeenCalled();
        await thread.hold(undefined);
        const response = await pending;

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("main");
        expect(onProxied).toHaveBeenCalledOnce();
      });
    });

    describe("when the hold moves to upgrading with one parked request's route held", () => {
      /** @scenario "A held request is released once its route serves while upgrading" */
      it("proxies the serving request and keeps holding the held one", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied, holdWindowMs: 300 });
        await thread.hold(holding);

        const ingest = fetch(urlOf(thread.address, "/api/otel/v1/traces"), { method: "POST" });
        const other = fetch(urlOf(thread.address, "/api/datasets"), { method: "POST" });
        await new Promise((resolve) => setTimeout(resolve, 50));
        await thread.hold(
          { phase: UPGRADING_PHASE, outstandingStepIds: ["clickhouse:00042"] },
          { paths: [], held: ["^POST /api/datasets$"] },
        );

        expect((await ingest).status).toBe(200);
        expect((await other).status).toBe(503);
        expect(onProxied).toHaveBeenCalledOnce();
      });
    });

    describe("when the hold is lifted", () => {
      /** @scenario "Lifting the hold sends requests to the main thread again" */
      it("proxies to the main thread again", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        await thread.hold(holding);
        await thread.hold(undefined);

        const response = await fetch(urlOf(thread.address, "/settings"), {
          headers: { Accept: "text/html" },
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("main");
        expect(onProxied).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given an upgrade with no outstanding step ids", () => {
    /** @scenario "The holding page names only the phase when no step is outstanding" */
    it("renders the phase and no step list", () => {
      const page = renderUpgradeHoldingPage({ phase: "upgrade-gate", outstandingStepIds: [] });

      expect(page).toContain("<strong>upgrade-gate</strong>");
      expect(page).not.toContain("Outstanding steps");
      expect(page).not.toContain("<ul>");
    });
  });

  describe("given the api serves in upgrading mode", () => {
    /** @scenario "The upgrading holding page offers sign-in to follow the upgrade" */
    it("links to sign-in returning to the Upgrades page, and the schema phase does not", () => {
      const upgrading = renderUpgradeHoldingPage({
        phase: UPGRADING_PHASE,
        outstandingStepIds: [],
      });
      const schema = renderUpgradeHoldingPage({ phase: "schema", outstandingStepIds: [] });

      expect(UPGRADE_SIGN_IN_HREF).toBe("/auth/signin?callbackUrl=%2Fops%2Fupgrades");
      expect(upgrading).toContain(
        `<a href="${UPGRADE_SIGN_IN_HREF}">Sign in to follow the upgrade</a>`,
      );
      expect(schema).not.toContain("<a ");
    });
  });

  describe("given a phase and step ids carrying markup", () => {
    /** @scenario "The holding page escapes everything it renders" */
    it("renders them escaped", () => {
      const page = renderUpgradeHoldingPage({
        phase: "<script>alert(1)</script>",
        outstandingStepIds: [`x:"><img src=x onerror=alert(1)>`],
      });

      expect(page).not.toContain("<script>");
      expect(page).not.toContain("<img");
      expect(page).toContain("&#60;script&#62;");
    });
  });
});

describe("the liveness door's routing while it holds", () => {
  describe("given the door holds with a health path, and in upgrading mode one held route", () => {
    const upgrading = { phase: UPGRADING_PHASE, outstandingStepIds: [] };
    const passThrough = { paths: ["/api/health"], held: ["^POST /api/datasets$"] };

    describe("when the kubelet requests the health route", () => {
      /** @scenario "A health route reaches the main thread while an upgrade holds the door" */
      it("proxies it to the main thread", async () => {
        const proxied = vi.fn();
        const thread = await bootThread({ onProxied: proxied });
        await thread.hold(holding, { paths: ["/api/health"] });

        const response = await fetch(urlOf(thread.address, "/api/health?probe=1"));

        expect(response.status).toBe(200);
        expect(proxied).toHaveBeenCalledOnce();
      });
    });

    describe("when requests name routes that serve, then the held one", () => {
      /** @scenario "In upgrading mode every route passes the holding door but the held ones" */
      it("proxies every route that does not hold and holds the held one before the main thread", async () => {
        const proxied = vi.fn();
        const thread = await bootThread({ onProxied: proxied });
        await thread.hold(upgrading, passThrough);

        const signIn = await fetch(urlOf(thread.address, "/api/auth/sign-in"), { method: "POST" });
        const page = await fetch(urlOf(thread.address, "/settings"), {
          headers: { Accept: "text/html" },
        });
        const read = await fetch(urlOf(thread.address, "/api/datasets"));
        const held = await fetch(urlOf(thread.address, "/api/datasets"), { method: "POST" });

        expect([signIn.status, page.status, read.status]).toEqual([200, 200, 200]);
        expect(held.status).toBe(503);
        expect(proxied).toHaveBeenCalledTimes(3);
      });
    });

    describe("when a batched tRPC call names a held procedure beside a serving one", () => {
      it("proxies a batch only when no procedure in it holds", async () => {
        const proxied = vi.fn();
        const thread = await bootThread({ onProxied: proxied });
        const batch = "^(?:GET|POST) /api/trpc/(?:[^/]*,)?(?:ops\\.purge)(?:,[^/]*)?$";
        await thread.hold(upgrading, { paths: [], held: [batch] });

        const serving = await fetch(urlOf(thread.address, "/api/trpc/ops.plan,ops.retry?batch=1"));
        const mixed = await fetch(urlOf(thread.address, "/api/trpc/ops.plan,ops.purge?batch=1"));

        expect(serving.status).toBe(200);
        expect(mixed.status).toBe(503);
        expect(proxied).toHaveBeenCalledOnce();
      });
    });
  });
});

describe("the liveness door's cap on parked requests", () => {
  describe("given the door holds and as many requests wait as it parks", () => {
    describe("when one more held request arrives", () => {
      /** @scenario "A flood of held requests past the cap is answered at once" */
      it("answers it 503 with Retry-After at once and keeps the parked one waiting", async () => {
        const proxied = vi.fn();
        const thread = await bootThread({ onProxied: proxied, holdWindowMs: 5_000, maxParked: 1 });
        await thread.hold(holding);

        const parked = fetch(urlOf(thread.address, "/api/otel/v1/traces"), { method: "POST" });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const startedAt = Date.now();
        const flooded = await fetch(urlOf(thread.address, "/api/otel/v1/traces"), {
          method: "POST",
        });

        expect(flooded.status).toBe(503);
        expect(flooded.headers.get("retry-after")).toBe("10");
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        await thread.hold(undefined);
        expect((await parked).status).toBe(200);
        expect(proxied).toHaveBeenCalledOnce();
      });
    });
  });
});

describe("the liveness door in upgrading mode", () => {
  const upgradingHold = { phase: UPGRADING_PHASE, outstandingStepIds: ["trace:fill-cost"] };

  describe("when a browser requests a page that holds", () => {
    /** @scenario "The holding page offers sign-in to follow the upgrade" */
    it("holds it with a link to sign-in returning to Ops > Upgrades, and the link passes", async () => {
      const proxied = vi.fn();
      const thread = await bootThread({ onProxied: proxied });
      await thread.hold(upgradingHold, { paths: [], held: ["^GET /settings$"] });

      const held = await fetch(urlOf(thread.address, "/settings"), {
        headers: { Accept: "text/html" },
      });
      const page = await held.text();
      const followed = await fetch(urlOf(thread.address, UPGRADE_SIGN_IN_HREF));

      expect(held.status).toBe(503);
      expect(page).toContain(`<a href="${UPGRADE_SIGN_IN_HREF}">Sign in to follow the upgrade</a>`);
      expect(UPGRADE_SIGN_IN_HREF).toBe("/auth/signin?callbackUrl=%2Fops%2Fupgrades");
      expect(followed.status).toBe(200);
      expect(proxied).toHaveBeenCalledOnce();
    });
  });
});
