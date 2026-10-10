import http from "node:http";

import { describe, expect, it } from "vitest";

import { freeLoopbackPort, replaceBackend } from "../backend.process.ts";
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
