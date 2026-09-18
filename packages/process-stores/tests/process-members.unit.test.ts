/**
 * What a process builds, what it refuses, and what it closes.
 *
 * Nothing here opens a socket: every test either hands the member in or reads
 * one this process was not configured for, which is the whole of the contract
 * a boot seam depends on.
 */
import { describe, expect, it, vi } from "vitest";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  createProcessMembers,
  MemberNotConfiguredError,
  MemberSuppliedUndefinedError,
} from "../src/create-members.ts";
import { aesEncryption, loggedTelemetry, resolvedSecrets, systemClock } from "../src/config-members.ts";
import { MEMBER_NAMES, reads, type ProcessConfig } from "../src/index.ts";

/** A process that named no datastore at all, and says so about its mail. */
function config(overrides: Partial<ProcessConfig> = {}): ProcessConfig {
  return {
    processName: "test",
    encryptionKey: Buffer.alloc(32, 7).toString("hex"),
    secrets: {},
    rateLimit: { requests: 10, seconds: 60 },
    mail: { provider: "off" },
    ...overrides,
  };
}

describe("given a process that hands in a member itself", () => {
  describe("when the member is read", () => {
    it("answers with what the caller passed", () => {
      const clock = { now: () => new Date("2026-09-10T12:00:00.000Z") };

      const members = createProcessMembers({ config: config(), members: { clock } });

      expect(members.read("clock")).toBe(clock);
    });

    it("never closes a client the caller owns", async () => {
      const clock = { now: () => new Date() };
      const members = createProcessMembers({ config: config(), members: { clock } });
      members.read("clock");

      await members.close();

      expect(members.read("clock")).toBe(clock);
    });
  });

  describe("when the member is handed in as an own property whose value is undefined", () => {
    /** @scenario "A member handed in as undefined is a refusal, not an omission" */
    it("refuses naming the member rather than building the real client", () => {
      expect(() =>
        createProcessMembers({
          config: config(),
          members: { clock: undefined as unknown as { now(): Date } },
        }),
      ).toThrow(MemberSuppliedUndefinedError);
    });
  });
});

describe("given a process that named no store", () => {
  describe("when a member that needs one is read", () => {
    /** @scenario "A store with no address refuses at boot" */
    it.each([
      ["prisma", "DATABASE_URL"],
      ["clickhouse", "CLICKHOUSE_URL"],
      ["redis", "REDIS_URL"],
    ] as const)("refuses %s by name", (member, hint) => {
      const members = createProcessMembers({ config: config() });

      expect(() => members.read(member)).toThrow(MemberNotConfiguredError);
      expect(() => members.read(member)).toThrow(hint);
    });

    it("refuses the members built over Redis for the same reason", () => {
      const members = createProcessMembers({ config: config() });

      for (const member of ["cache", "idempotency", "rateLimiter"] as const) {
        expect(() => members.read(member)).toThrow("REDIS_URL");
      }
    });

    it("refuses mail on a process started with the gateway off", () => {
      const members = createProcessMembers({ config: config() });

      expect(() => members.read("mail")).toThrow("MAIL_PROVIDER=off");
    });

    it("refuses object storage that names no bucket", () => {
      const members = createProcessMembers({ config: config() });

      expect(() => members.read("objectStorage")).toThrow(MemberNotConfiguredError);
    });
  });
});

describe("given the members built over one Redis connection", () => {
  describe("when the cache, the idempotency store and the limiter are read", () => {
    it("builds all three over the single connection handed in", () => {
      const calls: string[] = [];
      const redis = {
        getBuffer: () => {
          calls.push("cache");
          return Promise.resolve(null);
        },
        set: () => {
          calls.push("idempotency");
          return Promise.resolve("OK");
        },
        incr: () => {
          calls.push("rateLimiter");
          return Promise.resolve(1);
        },
        expire: () => Promise.resolve(1),
      } as unknown as RedisConnection;
      const members = createProcessMembers({ config: config(), members: { redis } });

      void members.read("cache").find("key");
      void members.read("idempotency").claim("key", 60);
      void members.read("rateLimiter").check("key");

      expect(calls).toEqual(["cache", "idempotency", "rateLimiter"]);
    });
  });
});

describe("given a member source with several clients open", () => {
  describe("when it is disposed", () => {
    it("closes what it opened, in reverse construction order", async () => {
      const closed: string[] = [];
      const members = createProcessMembers({
        config: config({
          eventing: {
            eventStore: {} as never,
            consumersEnabled: false,
            executionTarget: "api" as never,
          },
        }),
      });
      // The two members with a close of their own, in construction order.
      const eventing = members.read("eventing");
      vi.spyOn(eventing, "close").mockImplementation(() => {
        closed.push("eventing");
        return Promise.resolve();
      });

      await members[Symbol.asyncDispose]();

      expect(closed).toEqual(["eventing"]);
    });

    it("reads a member again after it closed, building it afresh", async () => {
      const members = createProcessMembers({ config: config() });
      const first = members.read("clock");

      await members.close();

      expect(members.read("clock")).not.toBe(first);
    });
  });
});

describe("given the closed member list", () => {
  describe("when it is read in construction order", () => {
    it("opens prisma before the two members that route on it", () => {
      const order = [...MEMBER_NAMES];

      expect(order.indexOf("prisma")).toBeLessThan(order.indexOf("clickhouse"));
      expect(order.indexOf("prisma")).toBeLessThan(order.indexOf("objectStorage"));
      expect(order.indexOf("redis")).toBeLessThan(order.indexOf("cache"));
      expect(order.indexOf("redis")).toBeLessThan(order.indexOf("idempotency"));
      expect(order.indexOf("redis")).toBeLessThan(order.indexOf("rateLimiter"));
    });

    it("names no audit member: the sink is the audit-log module's app", () => {
      expect([...MEMBER_NAMES]).not.toContain("audit");
      expect(MEMBER_NAMES).toHaveLength(14);
    });

    it("reads a module's declaration back as the tuple it wrote", () => {
      expect(reads("clock", "logger")).toEqual(["clock", "logger"]);
    });
  });
});

describe("given the members with no client behind them", () => {
  describe("when a value is encrypted", () => {
    it("reads the same value back", () => {
      const encryption = aesEncryption(Buffer.alloc(32, 3));

      expect(encryption.decrypt(encryption.encrypt("a secret"))).toBe("a secret");
    });

    it("writes a different ciphertext each time", () => {
      const encryption = aesEncryption(Buffer.alloc(32, 3));

      expect(encryption.encrypt("same")).not.toBe(encryption.encrypt("same"));
    });

    it("refuses a key that is not 32 bytes", () => {
      expect(() => aesEncryption(Buffer.alloc(16, 1))).toThrow("AES-256 needs 32");
    });
  });

  describe("when a secret this process was not started with is read", () => {
    it("refuses naming the key", () => {
      const secrets = resolvedSecrets({ PRESENT: "value" });

      expect(() => secrets.read("ABSENT")).toThrow('secret "ABSENT"');
      expect(secrets.find("ABSENT")).toBeUndefined();
      expect(secrets.read("PRESENT")).toBe("value");
    });
  });

  describe("when telemetry is written", () => {
    it("records the count and the observation against the logger", () => {
      const debug = vi.fn();
      const telemetry = loggedTelemetry({ debug } as never);

      telemetry.count("annotations.created");
      telemetry.observe("annotations.duration", 12);

      expect(debug).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the clock is read", () => {
    it("answers the wall clock", () => {
      expect(systemClock().now().getTime()).toBeGreaterThan(0);
    });
  });
});
