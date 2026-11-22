import { afterEach, describe, expect, it, vi } from "vitest";

import { Server } from "../server.ts";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

describe("Server", () => {
  describe("given hosted components that ask to hear shutdown begin", () => {
    describe("when the server closes", () => {
      /** @scenario "Hosted components hear shutdown begin before any of them stops" */
      it("tells every component it is stopping before the first one stops", async () => {
        const events: string[] = [];
        const server = Server.create({ name: "test-server", logger, ownsProcess: false });
        activeServers.push(server);
        server.with({
          name: "stores",
          stopping: () => events.push("stores stopping"),
          stop: () => {
            events.push("stores stopped");
          },
        });
        server.with({
          name: "runtime",
          stopping: () => events.push("runtime stopping"),
          stop: () => {
            events.push("runtime stopped");
          },
        });
        server.with({
          name: "plain",
          stop: () => {
            events.push("plain stopped");
          },
        });
        await server.listen();

        await server.close();

        expect(events).toEqual([
          "stores stopping",
          "runtime stopping",
          "plain stopped",
          "runtime stopped",
          "stores stopped",
        ]);
      });
    });
  });
});
