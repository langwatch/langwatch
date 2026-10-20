import { describe, expect, it } from "vitest";

import { predepGate, type PredepResult } from "../src/predeps/runner.ts";

const resolved = { version: "1", resolvedPath: "/bin/x", preInstalled: true };

describe("waiting on predeps while the rest install", () => {
  describe("when the predeps a service needs arrive before the others", () => {
    /** @scenario "The stores start while the app is still arriving" */
    it("lets that service go at once, with the predeps filled in", async () => {
      const predeps: PredepResult = {};
      const gate = predepGate({ predeps });
      const postgres = gate.ready(["postgres"]);
      const backend = gate.ready(["postgres", "app"]);
      let isBackendReleased = false;
      void backend.then(() => (isBackendReleased = true));

      gate.add({ id: "postgres", resolved });
      await postgres;
      await Promise.resolve();

      expect(predeps.postgres).toEqual(resolved);
      expect(isBackendReleased).toBe(false);

      gate.add({ id: "app", resolved });
      await expect(backend).resolves.toBeUndefined();
    });
  });

  describe("when the install finishes without a predep", () => {
    /** @scenario "The stores start while the app is still arriving" */
    it("fails the wait naming what did not install", async () => {
      const gate = predepGate({ predeps: {} });
      const waiting = gate.ready(["uv"]);

      gate.finish();

      await expect(waiting).rejects.toThrow("uv did not install");
    });
  });
});
