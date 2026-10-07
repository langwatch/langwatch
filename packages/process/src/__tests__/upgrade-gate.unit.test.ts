// @vitest-environment node
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../preamble.ts";
import type { UpgradeGatedRole, UpgradeGate } from "../upgrade-gate.ts";

type Recorded = string[];

function application(events: Recorded) {
  return {
    name: "gated-app",
    start: () => void events.push("application started"),
    stop: () => void events.push("application stopped"),
    handler: () => undefined,
  };
}

function gateAnswering({
  events,
  admit,
}: {
  events: Recorded;
  admit: () => ReturnType<UpgradeGate["admit"]>;
}): UpgradeGate {
  return {
    admit: async () => {
      events.push("gate asked");
      return admit();
    },
    release: async () => void events.push("roster entry removed"),
  };
}

const start = ({ gate, role = "worker" }: { gate: UpgradeGate; role?: UpgradeGatedRole }) =>
  Server.create("upgrade-gate-test")
    .withEnvironment({})
    .withConfig(processConfig([], "worker"))
    .withHealthPort(0)
    .withProcessOwnership(false)
    .withUpgradeGate({ role, gate: () => gate })
    .start();

describe("the preamble's upgrade gate", () => {
  describe("given a gate that admits", () => {
    /** @scenario "An admitted process asks the gate before its application starts" */
    it("asks the gate before the application starts", async () => {
      const events: Recorded = [];
      const server = await start({
        gate: gateAnswering({ events, admit: async () => ({ admitted: true }) }),
      });

      await server.serve(application(events));

      expect(events).toEqual(["gate asked", "application started"]);
      await server.close();
    });

    /** @scenario "The roster entry is written on start and removed on graceful stop" */
    it("releases the gate's roster entry after the application stopped", async () => {
      const events: Recorded = [];
      const server = await start({
        role: "api",
        gate: gateAnswering({ events, admit: async () => ({ admitted: true }) }),
      });
      await server.serve(application(events));

      await server.close();

      expect(events).toEqual([
        "gate asked",
        "application started",
        "application stopped",
        "roster entry removed",
      ]);
    });
  });

  describe("given a gate that refuses", () => {
    /** @scenario "A refused process never starts its application" */
    it("fails the start by code, naming the refusal, and never starts the application", async () => {
      const events: Recorded = [];
      const refusal = "behind: clickhouse:00042; run pnpm task upgrade";
      const server = await start({
        gate: gateAnswering({ events, admit: async () => ({ admitted: false, refusal }) }),
      });

      const failure = await server.serve(application(events)).catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: "upgrade_gate_refused", role: "worker", refusal });
      expect(events).toEqual(["gate asked"]);
      await server.close();
    });
  });

  describe("given a ledger that cannot be read", () => {
    /** @scenario "A ledger that cannot be read refuses the start" */
    it("fails the start naming the role and the cause", async () => {
      const events: Recorded = [];
      const server = await start({
        role: "api",
        gate: gateAnswering({
          events,
          admit: () => Promise.reject(new Error("connection refused")),
        }),
      });

      const failure = await server.serve(application(events)).catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: "upgrade_gate_refused", role: "api" });
      expect((failure as Error).message).toContain("connection refused");
      expect(events).toEqual(["gate asked"]);
      await server.close();
    });
  });

  describe("given the tasks role", () => {
    /** @scenario "The tasks role is never gated" */
    it("refuses to compose the gate, naming the role", () => {
      const compose = () =>
        Server.create("upgrade-gate-test")
          .withEnvironment({})
          .withConfig(processConfig([], "worker"))
          .withUpgradeGate({
            role: "tasks" as UpgradeGatedRole,
            gate: () => ({ admit: async () => ({ admitted: true }), release: async () => {} }),
          });

      expect(compose).toThrow(/"tasks"/);
    });
  });
});
