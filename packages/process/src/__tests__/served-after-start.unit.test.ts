/**
 * A request the upgrade hold releases while the components still start waits for the runtime
 * (API-UP). Spec: packages/process/specs/upgrade-holding-page.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { Server } from "../server.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function urlOf(server: Server): string {
  const address = server.healthAddress;
  if (address === null || typeof address === "string") throw new Error("no port bound");
  return `http://127.0.0.1:${address.port}/api/otel/v1/traces`;
}

describe("given a component still starting ahead of the runtime", () => {
  describe("when a request reaches the application", () => {
    /** @scenario "A released request reaches its handler only once the runtime has started" */
    it("waits for the runtime to start before the handler runs", async () => {
      let finishStarting = (): void => undefined;
      const starting = new Promise<void>((resolve) => {
        finishStarting = resolve;
      });
      const events: string[] = [];
      const server = Server.create({ name: "start-race", logger, ownsProcess: false });
      servers.push(server);
      server.with({ name: "upgrade gate", start: () => starting, stop: async () => {} });
      const serving = server.serve({
        name: "api",
        start: () => {
          events.push("runtime started");
        },
        stop: () => undefined,
        handler: (_request: unknown, response: { end: (body: string) => void }) => {
          events.push("handler");
          response.end("ok");
        },
      });
      await vi.waitFor(() => expect(server.healthAddress).not.toBeNull());

      const answered = fetch(urlOf(server), { method: "POST" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toEqual([]);
      finishStarting();
      await serving;

      expect(await (await answered).text()).toBe("ok");
      expect(events).toEqual(["runtime started", "handler"]);
    });
  });
});
