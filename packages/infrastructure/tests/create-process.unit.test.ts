/**
 * One statement for what a process is.
 *
 * Nothing here opens a socket: the process names no datastore, so the only
 * members it can answer with are the ones a caller hands in and the ones built
 * from config alone.
 */
import { describe, expect, it } from "vitest";
import { createProcess } from "../src/create-process.ts";
import { MemberSuppliedUndefinedError } from "../src/create-members.ts";
import type { ProcessConfig } from "../src/index.ts";

/** A process that named no datastore at all, and says so about its mail. */
function config(): ProcessConfig {
  return {
    processName: "test",
    encryptionKey: Buffer.alloc(32, 7).toString("hex"),
    secrets: {},
    rateLimit: { requests: 10, seconds: 60 },
    mail: { provider: "off" },
  };
}

describe("given a process stated with createProcess", () => {
  describe("when it is told which modules it installs", () => {
    it("boots with no module reading anything", async () => {
      const runtime = await createProcess({ role: "api", config: config() })
        .withModules([])
        .boot();

      expect(runtime.role).toBe("api");
      await runtime.stop();
    });
  });

  describe("when no installed module reads a member", () => {
    it("opens no client, even one the caller handed in", async () => {
      const clock = { now: () => new Date("2026-09-10T12:00:00.000Z") };

      const runtime = await createProcess({ role: "api", config: config(), members: { clock } })
        .withModules([])
        .boot();

      expect(Object.keys(runtime.members)).toEqual([]);
      await runtime.stop();
    });
  });

  describe("when the caller hands a member in as undefined", () => {
    it("refuses by name rather than building the real client", () => {
      expect(() =>
        createProcess({ role: "api", config: config(), members: { clock: undefined } }),
      ).toThrow(MemberSuppliedUndefinedError);
    });
  });
});
