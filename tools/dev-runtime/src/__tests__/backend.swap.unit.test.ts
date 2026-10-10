import http from "node:http";

import { describe, expect, it } from "vitest";

import { freeLoopbackPort, replaceBackend, startFreshBackend } from "../backend.process.ts";
import { forwardPortWithOrb } from "../haven-orb.ts";

const closed = { close: async () => {} };

/** A stand-in api generation answering its name on its own port. */
async function generationOn({ port, name }: { port: number; name: string }) {
  const server = http.createServer((_request, response) => response.end(name));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** One request on its own connection: a kept-alive one stays with the generation it reached. */
const get = (port: number): Promise<string> =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/api/health", agent: false }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () => resolve(body));
      })
      .on("error", reject);
  });

describe("given an api generation serving behind the stable port", () => {
  describe("when a reload replaces it", () => {
    /** @scenario "A reload swaps the api without closing its port" */
    it("boots the next api beside the old, moves the port, then drains the old and starts the worker", async () => {
      const steps: string[] = [];
      const stable = await freeLoopbackPort();
      const forwarder = await forwardPortWithOrb({ port: stable });
      const oldPort = await freeLoopbackPort();
      const old = await generationOn({ port: oldPort, name: "old" });
      forwarder.route(oldPort);
      expect(await get(stable)).toBe("old");

      const nextPort = await freeLoopbackPort();
      const replaced = await replaceBackend({
        apiPort: nextPort,
        startApi: async ({ port }) => {
          steps.push(`api on ${port === nextPort ? "next" : "?"}`);
          expect(await get(stable)).toBe("old");
          return generationOn({ port: nextPort, name: "next" });
        },
        route: (port) => {
          steps.push("route");
          forwarder.route(port);
        },
        disposeOld: async () => {
          steps.push("drain old");
          expect(await get(stable)).toBe("next");
          await old.close();
        },
        startWorker: async () => {
          steps.push("worker");
          return closed;
        },
      });

      expect(steps).toEqual(["api on next", "route", "drain old", "worker"]);
      expect(await get(stable)).toBe("next");
      await replaced.halves.api.close();
      await forwarder.close();
    });
  });

  describe("when the next api refuses boot", () => {
    /** @scenario "An api that refuses boot keeps the old generation serving" */
    it("leaves the port and the old generation alone", async () => {
      const steps: string[] = [];
      await expect(
        replaceBackend({
          apiPort: 1,
          startApi: async () => {
            throw new Error("bad edit");
          },
          route: () => void steps.push("route"),
          disposeOld: async () => void steps.push("drain old"),
          startWorker: async () => closed,
        }),
      ).rejects.toThrow("bad edit");
      expect(steps).toEqual([]);
    });
  });

  describe("when the next worker refuses boot", () => {
    /** @scenario "A worker that refuses boot leaves the new api serving" */
    it("answers the api with the worker's failure named", async () => {
      const api = { close: async () => {} };
      const replaced = await replaceBackend({
        apiPort: 1,
        startApi: async () => api,
        route: () => {},
        disposeOld: async () => {},
        startWorker: async () => {
          throw new Error("worker refused");
        },
      });
      expect(replaced.halves.api).toBe(api);
      expect(replaced.workerFailure).toBeInstanceOf(Error);
    });
  });
});

describe("given the host holding the stable port with no generation serving", () => {
  describe("when the api starts while the worker is still booting", () => {
    /** @scenario "A cold boot routes the api before the worker has finished booting" */
    it("routes the port to the api before the worker resolves", async () => {
      const stable = await freeLoopbackPort();
      const forwarder = await forwardPortWithOrb({ port: stable });
      const apiPort = await freeLoopbackPort();
      let finishWorker = (): void => {};
      const booting = startFreshBackend({
        apiPort,
        route: (port) => forwarder.route(port),
        startApi: async ({ port }) => generationOn({ port: port ?? 0, name: "api" }),
        startWorker: async () => {
          await new Promise<void>((resolve) => (finishWorker = resolve));
          return closed;
        },
      });
      // The worker cannot resolve until finishWorker runs, so this answer is mid-boot.
      await expect.poll(() => get(stable).catch(() => undefined)).toBe("api");
      finishWorker();
      const started = await booting;

      expect(started.workerFailure).toBeUndefined();
      await started.halves.api.close();
      await forwarder.close();
    });
  });

  describe("when the worker then refuses boot", () => {
    /** @scenario "A cold boot routes the api before the worker has finished booting" */
    it("keeps the api routed and answers the worker's failure for the retry", async () => {
      const routed: number[] = [];
      const api = { close: async () => {} };
      const started = await startFreshBackend({
        apiPort: 7,
        route: (port) => void routed.push(port),
        startApi: async () => api,
        startWorker: async () => {
          throw new Error("worker refused");
        },
      });
      expect(routed).toEqual([7]);
      expect(started.halves.api).toBe(api);
      expect(started.workerFailure).toBeInstanceOf(Error);
    });
  });

  describe("when the api refuses boot", () => {
    /** @scenario "A cold boot routes the api before the worker has finished booting" */
    it("never routes the port", async () => {
      const routed: number[] = [];
      await expect(
        startFreshBackend({
          apiPort: 7,
          route: (port) => void routed.push(port),
          startApi: async () => {
            throw new Error("api refused");
          },
          startWorker: async () => closed,
        }),
      ).rejects.toThrow("api refused");
      expect(routed).toEqual([]);
    });
  });
});
