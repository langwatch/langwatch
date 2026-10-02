import { createApp } from "@langwatch/process";
/**
 * One statement for what a process is. Nothing here opens a socket: the process names no datastore,
 * so the only members it can answer with are the ones a caller hands in and the ones built from
 * config alone.
 */
import { describe, expect, it } from "vitest";

describe("given a process stated with createProcess", () => {
  describe("when it is told which modules it installs", () => {
    it("boots with no module reading anything", async () => {
      const runtime = await createApp({ role: "api" }).withModules([]).boot();

      expect(runtime.role).toBe("api");
      await runtime.stop();
    });
  });

  describe("when no installed module reads a member", () => {
    it("opens no client, even one the caller handed in", async () => {
      const clock = { now: () => new Date("2026-09-10T12:00:00.000Z") };

      const runtime = await createApp({ role: "api" }).withClock(clock).withModules([]).boot();

      expect(Object.keys(runtime.members)).toEqual([]);
      await runtime.stop();
    });
  });
});
