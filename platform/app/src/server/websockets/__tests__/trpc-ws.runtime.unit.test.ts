import { createServer } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";

const broadcastReconnectNotification = vi.fn();

vi.mock("@trpc/server/adapters/ws", () => ({
  applyWSSHandler: vi.fn(() => ({ broadcastReconnectNotification })),
}));
vi.mock("../../api/root", () => ({ appRouter: {} }));
vi.mock("../../api/trpc", () => ({
  createTRPCContext: vi.fn(),
}));

import { TrpcWebSocketRuntime } from "../trpc-ws";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(() => {
  for (const server of servers) server.removeAllListeners();
  servers.length = 0;
});

describe("TrpcWebSocketRuntime", () => {
  it("removes its exact upgrade listener when closed", async () => {
    const server = createServer();
    servers.push(server);
    const runtime = TrpcWebSocketRuntime.create({
      server,
      app: {} as never,
      config: { allowedOrigins: ["https://app.langwatch.ai"] },
    });

    const handle = runtime.start();
    const upgradeListeners = server.listeners("upgrade");
    expect(upgradeListeners).toHaveLength(1);

    await handle.close();

    expect(server.listeners("upgrade")).toEqual([]);
    await handle.close();
  });
});
