import { connect, createServer } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startApi } from "../main.ts";

describe("the api process boot", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("given an environment carrying an unreadable value", () => {
    /** @scenario "The API validates its configuration before it composes or listens" */
    /** @scenario "A misconfigured value refuses the boot and names the leaf" */
    it("refuses with the configuration parse, naming the variable, before anything composes", async () => {
      vi.stubEnv("API_PORT", "not-a-port");

      const failure = await startApi({ ownsProcess: false, ownsTelemetry: false }).then(
        () => void 0,
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({ code: "config_refused" });
      expect(failure).toHaveProperty(
        "refusals",
        expect.arrayContaining([expect.stringContaining("API_PORT")]),
      );
    });
  });
  describe("given a free configured port and a value that cannot be read", () => {
    /** @scenario "A refused boot leaves the configured port free" */
    it("refuses the boot and nothing listens on that port", async () => {
      const port = await freePort();
      vi.stubEnv("API_PORT", String(port));
      vi.stubEnv("PROCESS_SHUTDOWN_DEADLINE_MS", "soon");

      const failure = await startApi({ ownsProcess: false, ownsTelemetry: false }).then(
        () => void 0,
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({ code: "config_refused" });
      expect(failure).toHaveProperty(
        "refusals",
        expect.arrayContaining([expect.stringContaining("PROCESS_SHUTDOWN_DEADLINE_MS")]),
      );
      await expect(listensOn(port)).resolves.toBe(false);
    });
  });
});
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no ephemeral port");
  return address.port;
}

/** True when something accepts a connection on the port. */
async function listensOn(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
