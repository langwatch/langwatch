import { SecretsChain } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import { resolveTasksConfig } from "../config.ts";
import { systemMigrationsPass } from "../system-migrations-pass.ts";

const runModuleTask = vi.hoisted(() =>
  vi.fn<(input: { name: string; args: readonly string[]; signal: AbortSignal }) => Promise<void>>(),
);

vi.mock("../module-task.ts", () => ({ runModuleTask }));

function input(signal: AbortSignal) {
  return {
    config: resolveTasksConfig({ NODE_ENV: "test" }),
    connections: { database: null, redis: null },
    chain: SecretsChain.start({ environment: {} }),
    environment: {},
    signal,
  };
}

describe("given the system migration task", () => {
  describe("when it runs", () => {
    it("runs ops' declared pass in the tasks container, under the runner's signal", async () => {
      runModuleTask.mockResolvedValue(undefined);
      const signal = new AbortController().signal;

      await systemMigrationsPass(input(signal));

      expect(runModuleTask).toHaveBeenCalledWith({
        name: "system-migrations-pass",
        args: [],
        signal,
      });
    });
  });

  describe("when the pass fails", () => {
    it("propagates the failure to the sequence", async () => {
      runModuleTask.mockRejectedValue(new Error("pass failed"));

      await expect(systemMigrationsPass(input(new AbortController().signal))).rejects.toThrow(
        "pass failed",
      );
    });
  });
});
