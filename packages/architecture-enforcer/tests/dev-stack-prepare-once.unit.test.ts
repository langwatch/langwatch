/**
 * The local launcher migrates once, before any lane starts.
 * Corresponds to specs/setup/boot-sequence.feature. Read from dev-stack.sh
 * itself so a moved step is a failure here rather than a silent drift.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_STACK = path.resolve(HERE, "../../../dev/scripts/dev-stack.sh");

const PREPARE = /run start:prepare:db/;

describe("given the local stack launcher", () => {
  const lines = readFileSync(DEV_STACK, "utf8")
    .split("\n")
    .map((text, index) => ({ text, number: index + 1 }))
    .filter(({ text }) => !text.trimStart().startsWith("#"));

  describe("when it starts the stack", () => {
    /** @scenario "The local stack launcher migrates once, before the lanes" */
    it("runs the preparation step once, before any lane is added or started", () => {
      const preparing = lines.filter(({ text }) => PREPARE.test(text));
      const firstLane = lines.find(({ text }) => /^\s*add_lane \S/.test(text));
      const launch = lines.find(({ text }) => /exec pnpm --silent exec concurrently/.test(text));

      expect(preparing).toHaveLength(1);
      expect(firstLane).toBeDefined();
      expect(launch).toBeDefined();
      expect(preparing[0]!.number).toBeLessThan(firstLane!.number);
      expect(preparing[0]!.number).toBeLessThan(launch!.number);
    });

    it("puts no preparation inside any lane's own command", () => {
      const inLane = lines.filter(
        ({ text }) => /add_lane \S/.test(text) && /start:prepare|migrate/.test(text),
      );

      expect(inLane).toEqual([]);
    });
  });
});
