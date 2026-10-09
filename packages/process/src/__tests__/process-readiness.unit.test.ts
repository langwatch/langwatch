// @vitest-environment node
import { createServer } from "node:net";

import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";

import { processConfig } from "../config.ts";
import { defineProcessModule } from "../feature-installer.ts";
import { Server as Preamble } from "../preamble.ts";
import { Server } from "../server.ts";

/** Spec: specs/server/process-readiness.feature */
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

function gate(): { held: Promise<void>; release: () => void } {
  let release: () => void = () => void 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

const statusOf = async (port: number, path: string): Promise<number> =>
  (await fetch(`http://127.0.0.1:${port}${path}`)).status;

interface BootingApi {
  booted(): boolean;
}
const BootingApi = moduleApi<BootingApi>()("annotation");

/** One module whose boot waits on `boot`, so a test can probe the process mid-boot. */
function bootingModule(boot: () => Promise<void>) {
  class BootingApp implements BootingApi {
    static readonly contract = BootingApi;
    static readonly dependencies = {};

    static async create(): Promise<BootingApp> {
      await boot();
      return new BootingApp();
    }

    booted(): boolean {
      return true;
    }
  }
  return defineProcessModule("annotation").withApi(BootingApp).build();
}

async function processOver(boot: () => Promise<void>) {
  const port = await freePort();
  const server = await Preamble.create("readiness-test")
    .withEnvironment({})
    .withConfig(processConfig([bootingModule(boot)], "worker"))
    .withHealthPort(port)
    .withProcessOwnership(false)
    .withSecrets((_, secrets) => secrets.withEnv())
    .start();
  return { port, server };
}

describe("a process whose module boot is held", () => {
  describe("when the kubelet asks /healthz and /readyz mid-boot, then after it serves", () => {
    /**
     * @scenario "Liveness answers while the modules are still booting"
     * @scenario "Readiness turns 200 once boot finished and the stores answer"
     * @scenario "Readiness answers 503 until the process is ready"
     */
    it("is live but not ready until boot finished, then ready", async () => {
      const { held, release } = gate();
      const { port, server } = await processOver(() => held);
      try {
        const booting = server.container("worker").boot();

        expect(await eventually(() => statusOf(port, "/healthz"))).toBe(200);
        expect(await statusOf(port, "/readyz")).toBe(503);

        release();
        await server.run(await booting);

        expect(await statusOf(port, "/readyz")).toBe(200);
        // Latched: the liveness thread answers it now, without asking the main loop.
        expect(await statusOf(port, "/readyz")).toBe(200);
      } finally {
        release();
        await server.close();
      }
    });
  });
});

describe("a process whose module boot fails", () => {
  describe("when the kubelet asks /readyz after the failure", () => {
    /** @scenario "A failed boot never turns ready" */
    it("answers 503 while /healthz still answers 200", async () => {
      const { port, server } = await processOver(() =>
        Promise.reject(new Error("module boot failed")),
      );
      try {
        await expect(server.container("worker").boot()).rejects.toThrow("module boot failed");

        expect(await statusOf(port, "/readyz")).toBe(503);
        expect(await statusOf(port, "/healthz")).toBe(200);
      } finally {
        await server.close();
      }
    });
  });
});

describe("a booted server one of whose components does not answer", () => {
  describe("when the kubelet asks /readyz before and after the component answers", () => {
    /** @scenario "A store that does not answer keeps the process unready" */
    it("answers 503 until the component answers, then 200", async () => {
      let answering = false;
      const server = Server.create({ name: "readiness-store", logger, ownsProcess: false });
      server.with({
        name: "process stores",
        stop: () => undefined,
        ready: () =>
          answering ? Promise.resolve() : Promise.reject(new Error("store did not answer")),
      });
      try {
        await server.openLiveness();
        await server.listen();
        const address = server.healthAddress;
        if (address === null || typeof address === "string") throw new Error("no port bound");

        expect(await statusOf(address.port, "/readyz")).toBe(503);
        answering = true;
        expect(await statusOf(address.port, "/readyz")).toBe(200);
      } finally {
        await server.close();
      }
    });
  });
});

describe("a ready server that begins to shut down", () => {
  describe("when the kubelet asks /readyz while a component is still draining", () => {
    /** @scenario "A draining process is no longer ready" */
    it("answers 503", async () => {
      const { held, release } = gate();
      const server = Server.create({ name: "readiness-drain", logger, ownsProcess: false });
      server.with({ name: "slow drain", stop: () => held });
      try {
        await server.openLiveness();
        await server.listen();
        const address = server.healthAddress;
        if (address === null || typeof address === "string") throw new Error("no port bound");
        expect(await statusOf(address.port, "/readyz")).toBe(200);

        const closing = server.close();

        expect(await statusOf(address.port, "/readyz")).toBe(503);
        release();
        await closing;
      } finally {
        release();
        await server.close();
      }
    });
  });
});
