/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it } from "vitest";

import { assertCurrent, firstInstallVerdict, type ServingVerdict } from "../serving-gate.ts";
import { admitAfterFirstInstall } from "../serving-upgrade-gate.ts";

const BEHIND_IMAGE = { release: "3.21.0", blockingSteps: ["prisma:20261006180000_add_column"] };

describe("admitAfterFirstInstall", () => {
  describe("given an api on an empty ledger and an empty schema", () => {
    /** @scenario "The api's first install says it runs the upgrade once before serving" */
    it("says this is a first install and that it runs the upgrade once, before running it", async () => {
      const said: { message: string; fields?: Record<string, unknown> }[] = [];
      const answers: ServingVerdict[] = [
        firstInstallVerdict(),
        { admitted: true, outcome: "current" },
      ];
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? firstInstallVerdict() },
        firstInstall: async () => {
          said.push({ message: "upgrade ran" });
          return { exitCode: 0, logTail: [] };
        },
        warn: (message, fields) => void said.push({ message, fields }),
      });

      expect(verdict).toEqual({ admitted: true, outcome: "current" });
      expect(said.map((line) => line.message)).toEqual([
        expect.stringMatching(/^first install: .*runs `pnpm task upgrade` once before it serves/),
        "upgrade ran",
      ]);
      expect(said[0]?.fields).toMatchObject({ phase: "first-install", next: expect.any(String) });
    });
  });

  describe("given an api whose installation is behind its image on one blocking step", () => {
    /** @scenario "The api says it runs the upgrade because the installation is behind, naming the steps" */
    it("says the installation is behind, naming the step, before running the upgrade", async () => {
      const said: { message: string; fields?: Record<string, unknown> }[] = [];
      const answers: ServingVerdict[] = [
        assertCurrent({ ledger: { steps: [] }, image: BEHIND_IMAGE, floor: null }),
        { admitted: true, outcome: "current" },
      ];
      const verdict = await admitAfterFirstInstall({
        gate: { admit: async () => answers.shift() ?? { admitted: true, outcome: "current" } },
        firstInstall: async () => {
          said.push({ message: "upgrade ran" });
          return { exitCode: 0, logTail: [] };
        },
        warn: (message, fields) => void said.push({ message, fields }),
      });

      expect(verdict).toEqual({ admitted: true, outcome: "current" });
      expect(said[0]?.message).toMatch(/behind this image: .*prisma:20261006180000_add_column/);
      expect(said[0]?.message).toContain("`pnpm task upgrade`");
      expect(said[0]?.fields).toMatchObject({
        phase: "behind",
        next: expect.stringMatching(/^nothing to do/),
      });
      expect(said[1]?.message).toBe("upgrade ran");
    });
  });

  describe("given an api whose release is below the ledger's floor", () => {
    /** @scenario "An image below the installation's floor runs nothing and refuses" */
    it("runs no upgrade and refuses naming the floor", async () => {
      let runs = 0;
      const verdict = await admitAfterFirstInstall({
        gate: {
          admit: async () =>
            assertCurrent({ ledger: { steps: [] }, image: BEHIND_IMAGE, floor: "3.22.0" }),
        },
        firstInstall: async () => {
          runs += 1;
          return { exitCode: 0, logTail: [] };
        },
        warn: () => undefined,
      });

      expect(runs).toBe(0);
      expect(verdict).toMatchObject({ admitted: false, outcome: "below-floor", floor: "3.22.0" });
    });
  });
});
