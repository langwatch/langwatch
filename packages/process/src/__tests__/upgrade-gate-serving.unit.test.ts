// @vitest-environment node
import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import type { UpgradeGate } from "../migration/upgrade-gate.ts";
import { eventingConsumers, type EventingHost } from "../module-eventing.ts";
import { Server } from "../preamble.ts";

type Recorded = string[];

const POLL_WAIT_MS = 1_300;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function switchableGate({ events }: { events: Recorded }) {
  const state = { serving: true };
  const gate: UpgradeGate = {
    admit: async () => ({ admitted: true }),
    release: async () => void events.push("roster entry removed"),
    serving: () => state.serving,
    backgroundSteps: {
      isStep: (contribution): contribution is { readonly id: string } =>
        typeof contribution === "object" && contribution !== null && "id" in contribution,
      start: (steps) => {
        events.push(`background started: ${steps.map((step) => step.id).join(",")}`);
        return { stop: async () => void events.push("background stopped") };
      },
    },
  };
  return { gate, state };
}

function worker(events: Recorded) {
  return {
    name: "gated-worker",
    role: "worker" as const,
    start: () => void events.push("application started"),
    stop: () => void events.push("application stopped"),
    holdWork: async (held: boolean) => void events.push(held ? "work paused" : "work resumed"),
    migrationSteps: <Step extends { readonly id: string }>(
      isStep: (contribution: unknown) => contribution is Step,
    ): readonly Step[] =>
      [{ id: "identity:reopen-unproven-accounts" }, "not a step"].filter(isStep),
  };
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port bound");
  return address.port;
}

const start = (gate: UpgradeGate, port = 0) =>
  Server.create("upgrade-serving-test")
    .withEnvironment({})
    .withConfig(processConfig([], "worker"))
    .withHealthPort(port)
    .withProcessOwnership(false)
    .withUpgradeGate({ role: "worker", gate: () => gate })
    .start();

const readiness = async (port: number): Promise<number> =>
  (await fetch(`http://127.0.0.1:${port}/readyz`)).status;

describe("a gated process whose roster entry lapses", () => {
  /** @scenario "Readiness fails while the roster entry is lapsed and passes again after a good write" */
  it("turns readiness off while lapsed and on again after a good write", async () => {
    const events: Recorded = [];
    const { gate, state } = switchableGate({ events });
    const port = await freePort();
    const server = await start(gate, port);
    await server.run(worker(events));
    try {
      expect(await readiness(port)).toBe(200);

      state.serving = false;
      await wait(POLL_WAIT_MS);
      expect(await readiness(port)).toBe(503);

      state.serving = true;
      await wait(POLL_WAIT_MS);
      expect(await readiness(port)).toBe(200);
    } finally {
      await server.close();
    }
  });

  /** @scenario "A worker pauses taking jobs while its roster entry is lapsed and resumes after a good write" */
  it("pauses the worker's work while lapsed and resumes it after a good write", async () => {
    const events: Recorded = [];
    const { gate, state } = switchableGate({ events });
    const server = await start(gate);
    await server.run(worker(events));
    try {
      state.serving = false;
      await wait(POLL_WAIT_MS);
      state.serving = true;
      await wait(POLL_WAIT_MS);
      expect(events.filter((event) => event.startsWith("work"))).toEqual([
        "work paused",
        "work resumed",
      ]);
    } finally {
      await server.close();
    }
  });
});

describe("a gated worker's background steps", () => {
  /** @scenario "Only a gated worker runs background steps, inside its runtime" */
  it("starts them after the application and stops them before it", async () => {
    const events: Recorded = [];
    const { gate } = switchableGate({ events });
    const server = await start(gate);
    await server.run(worker(events));
    await server.close();

    expect(events).toEqual([
      "application started",
      "background started: identity:reopen-unproven-accounts",
      "background stopped",
      "application stopped",
      "roster entry removed",
    ]);
  });
});

describe("the worker's eventing consumers", () => {
  /** @scenario "The worker's runtime pauses and resumes its eventing consumers" */
  it("pause and resume through the eventing host", async () => {
    const events: Recorded = [];
    const host: EventingHost = {
      participation: "consume",
      processStore: undefined,
      register: () => undefined,
      holdConsumers: () => undefined,
      startConsumers: () => undefined,
      pauseConsumers: () => void events.push("consumers paused"),
      resumeConsumers: () => void events.push("consumers resumed"),
    };
    const [service] = eventingConsumers(host);

    await service?.pause?.();
    await service?.resume?.();

    expect(events).toEqual(["consumers paused", "consumers resumed"]);
  });
});
