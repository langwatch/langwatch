/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 */
import { describe, expect, it } from "vitest";

import { firstInstallVerdict, type ServingVerdict } from "../serving-gate.ts";
import { admitAfterFirstInstall } from "../serving-upgrade-gate.ts";

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
          return 0;
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
});
