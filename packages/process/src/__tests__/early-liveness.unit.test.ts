// @vitest-environment node
import { createServer } from "node:net";

import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";

import { processConfig } from "../config.ts";
import { defineProcessModule } from "../feature-installer.ts";
import { Server as Preamble } from "../preamble.ts";
import { Server } from "../server.ts";

const logger = { info: vi.fn(), error: vi.fn() };

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port bound");
  return address.port;
}

async function eventually<T>(attempt: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

interface SlowApi {
  ready(): boolean;
}
const SlowApi = moduleApi<SlowApi>()("annotation");

describe("a worker whose boot is held by a slow stage", () => {
  describe("when the kubelet asks /healthz while the stage is still running", () => {
    /** @scenario "The liveness server boots before every other stage, including the voice tunnel" */
    it("answers 200 before the stage completes, and the stage then completes", async () => {
      let release: () => void = () => void 0;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      class SlowApp implements SlowApi {
        static readonly contract = SlowApi;
        static readonly dependencies = {};

        static async create(): Promise<SlowApp> {
          await gate;
          return new SlowApp();
        }

        ready(): boolean {
          return true;
        }
      }
      const slow = defineProcessModule("annotation").withApi(SlowApp).build();
      const port = await freePort();
      const server = await Preamble.create("early-liveness-test")
        .withEnvironment({})
        .withConfig(processConfig([slow], "worker"))
        .withHealthPort(port)
        .withProcessOwnership(false)
        .withSecrets((_, secrets) => secrets.withEnv())
        .start();
      try {
        let stageDone = false;
        const booting = server
          .container("worker")
          .boot({ classifyEventLogRetention: () => "traces" })
          .then((application) => {
            stageDone = true;
            return application;
          });

        const response = await eventually(() => fetch(`http://127.0.0.1:${port}/healthz`));

        expect(response.status).toBe(200);
        expect(stageDone).toBe(false);
        release();
        const application = await booting;
        await server.run(application);
        expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
      } finally {
        release();
        await server.close();
      }
    });
  });
});

describe("a server whose liveness door opened ahead of listen", () => {
  describe("when listen then starts the hosted components", () => {
    it("keeps the one door it opened rather than binding a second", async () => {
      const server = Server.create({ name: "early-door", logger, ownsProcess: false });
      try {
        await server.openLiveness();
        const opened = server.healthAddress;
        await server.listen();

        expect(opened).not.toBeNull();
        expect(server.healthAddress).toEqual(opened);
      } finally {
        await server.close();
      }
    });
  });

  describe("when the server closes without ever listening", () => {
    it("releases the port the early door held", async () => {
      const server = Server.create({ name: "early-door", logger, ownsProcess: false });
      await server.openLiveness();
      const address = server.healthAddress;
      if (address === null || typeof address === "string") throw new Error("no port bound");

      await server.close();

      await expect(fetch(`http://127.0.0.1:${address.port}/healthz`)).rejects.toThrow(TypeError);
    });
  });
});
