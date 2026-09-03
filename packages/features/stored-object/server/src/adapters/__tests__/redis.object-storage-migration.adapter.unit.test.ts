import { beforeEach, describe, expect, it, vi } from "vitest";

const { connect, connection } = vi.hoisted(() => {
  const connection = { disconnect: vi.fn() };
  return { connect: vi.fn(() => connection), connection };
});

vi.mock("@langwatch/redis-client", () => ({
  RedisConnectionService: class RedisConnectionService {
    connect = connect;
  },
}));

import { MigrationCutoverRedisAudit } from "../redis.object-storage-migration.adapter";

const logger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

function emptyAuditRedis() {
  return {
    disconnect: connection.disconnect,
    get: vi.fn(async () => null),
    hvals: vi.fn(async () => []),
    scard: vi.fn(async () => 0),
    scan: vi.fn(async (): Promise<[string, string[]]> => ["0", []]),
    smembers: vi.fn(async () => []),
    zcard: vi.fn(async () => 0),
    zcount: vi.fn(async () => 0),
  };
}

describe("MigrationCutoverRedisAudit", () => {
  beforeEach(() => {
    connect.mockReset();
    connection.disconnect.mockReset();
    logger.error.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  it("disconnects the task-local Redis connection after a successful audit", async () => {
    const redis = emptyAuditRedis();
    connect.mockReturnValue(redis);

    await expect(
      MigrationCutoverRedisAudit.create({
        config: { url: "redis://migration.example.test" },
        logger,
      }).audit(),
    ).resolves.toEqual([]);

    expect(connect).toHaveBeenCalledWith({ url: "redis://migration.example.test" });
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it("retains an audit failure while still closing the owned Redis connection", async () => {
    const redis = emptyAuditRedis();
    const operationFailure = new Error("audit failed");
    redis.smembers.mockRejectedValue(operationFailure);
    connect.mockReturnValue(redis);

    await expect(MigrationCutoverRedisAudit.create({ config: {}, logger }).audit()).rejects.toThrow(
      operationFailure,
    );

    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it("closes both owned resources and retains the first cleanup failure", async () => {
    const redis = emptyAuditRedis();
    const duplicateCloseFailure = new Error("duplicate close failed");
    const connectionCloseFailure = new Error("connection close failed");
    const auditConnection = {
      disconnect: vi.fn(() => {
        throw connectionCloseFailure;
      }),
    };
    const lease = {
      cleanup: vi.fn(() => {
        throw duplicateCloseFailure;
      }),
      redis,
      scanNodes: [redis],
    };
    connect.mockReturnValue(auditConnection);

    await expect(
      MigrationCutoverRedisAudit.create({
        config: {},
        createLease: async () => lease,
        logger,
      }).audit(),
    ).rejects.toThrow(duplicateCloseFailure);

    expect(lease.cleanup).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      { error: duplicateCloseFailure },
      "failed to close cutover-audit Redis duplicate",
    );
    expect(logger.error).toHaveBeenCalledWith(
      { error: connectionCloseFailure },
      "failed to close cutover-audit Redis connection",
    );
  });
});
