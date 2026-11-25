/**
 * The worker's gate is handed its modules, and `runUpgradeOnce` answers the gate's run.
 * @see specs/upgrade/upgrade-command.feature
 * @see specs/upgrade/entry-points.feature
 */
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import type { UpgradeGate, UpgradeGateModules } from "../migration/upgrade-gate.ts";
import { Server } from "../preamble.ts";

const preambleFor = ({ role, gate }: { role: "api" | "worker"; gate: UpgradeGate }) => {
  const handed: { bootModules: UpgradeGateModules | undefined }[] = [];
  const preamble = Server.create("upgrade-run-once-test")
    .withEnvironment({})
    .withConfig(processConfig([], role === "worker" ? "worker" : "api"))
    .withHealthPort(0)
    .withProcessOwnership(false)
    .withUpgradeGate({
      role,
      gate: ({ bootModules }) => {
        handed.push({ bootModules });
        return gate;
      },
    });
  return { preamble, handed };
};

describe("a worker started to run the upgrade once", () => {
  /** @scenario "pnpm task upgrade runs the upgrade as a run-once worker and answers its exit code" */
  it("answers the gate's run, releases the gate and is handed its modules", async () => {
    const events: string[] = [];
    const { preamble, handed } = preambleFor({
      role: "worker",
      gate: {
        admit: async () => ({ admitted: true }),
        release: async () => void events.push("released"),
        runOnce: async () => {
          events.push("ran");
          return 3;
        },
      },
    });

    const exitCode = await preamble.runUpgradeOnce();

    expect(exitCode).toBe(3);
    expect(events).toEqual(["ran", "released"]);
    expect(typeof handed[0]?.bootModules).toBe("function");
  });
});

describe("an api's gate", () => {
  it("is handed no modules, since the api never runs a step", async () => {
    const { preamble, handed } = preambleFor({
      role: "api",
      gate: { admit: async () => ({ admitted: true }), release: async () => undefined },
    });

    const server = await preamble.start();
    await server.close();

    expect(handed).toEqual([{ bootModules: undefined }]);
  });
});
