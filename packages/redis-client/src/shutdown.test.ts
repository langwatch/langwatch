import { describe, expect, it, vi } from "vitest";
import { RedisShutdownService } from "./shutdown";
import type { RedisConnection } from "./types";

function connectionThat(disconnect: () => void): RedisConnection {
  return { disconnect } as unknown as RedisConnection;
}

describe("RedisShutdownService", () => {
  it("disconnects a standalone or cluster connection once", async () => {
    const disconnect = vi.fn();
    const connection = connectionThat(disconnect);
    const shutdown = RedisShutdownService.create();

    await Promise.all([shutdown.shutdown(connection), shutdown.shutdown(connection)]);

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("does not share lifecycle state between shutdown owners", async () => {
    const disconnect = vi.fn();
    const connection = connectionThat(disconnect);

    await RedisShutdownService.create().shutdown(connection);
    await RedisShutdownService.create().shutdown(connection);

    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("returns the same failed close promise to concurrent callers", async () => {
    const error = new Error("disconnect failed");
    const disconnect = vi.fn(() => {
      throw error;
    });
    const connection = connectionThat(disconnect);
    const shutdown = RedisShutdownService.create();

    const first = shutdown.shutdown(connection);
    const second = shutdown.shutdown(connection);

    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
