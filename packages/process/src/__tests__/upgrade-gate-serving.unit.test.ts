// @vitest-environment node
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import type { UpgradeGate } from "../migration/upgrade-gate.ts";
import { Server } from "../preamble.ts";

type Recorded = string[];

function workerGate({ events }: { events: Recorded }): UpgradeGate {
  return {
    admit: async () => ({ admitted: true }),
    release: async () => void events.push("roster entry removed"),
    backgroundSteps: {
      isStep: (contribution): contribution is { readonly id: string } =>
        typeof contribution === "object" && contribution !== null && "id" in contribution,
      start: (steps) => {
        events.push(`background started: ${steps.map((step) => step.id).join(",")}`);
        return { stop: async () => void events.push("background stopped") };
      },
    },
  };
}

function worker(events: Recorded) {
  return {
    name: "gated-worker",
    role: "worker" as const,
    start: () => void events.push("application started"),
    stop: () => void events.push("application stopped"),
    migrationSteps: <Step extends { readonly id: string }>(
      isStep: (contribution: unknown) => contribution is Step,
    ): readonly Step[] =>
      [{ id: "identity:reopen-unproven-accounts" }, "not a step"].filter(isStep),
  };
}

const start = (gate: UpgradeGate) =>
  Server.create("upgrade-serving-test")
    .withEnvironment({})
    .withConfig(processConfig([], "worker"))
    .withHealthPort(0)
    .withProcessOwnership(false)
    .withUpgradeGate({ role: "worker", gate: () => gate })
    .start();

describe("a gated worker's background steps", () => {
  /** @scenario "Only a gated worker runs background steps, inside its runtime" */
  it("starts them after the application and stops them before it", async () => {
    const events: Recorded = [];
    const gate = workerGate({ events });
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
