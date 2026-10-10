/**
 * The image's generated code step list: the check that keeps it fresh, the read that refuses a
 * malformed one, and the gate that declares and requires what it names.
 * Specs: packages/upgrade/specs/image-code-steps.feature, specs/upgrade/serving-gate.feature
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ServingRosterEntry } from "../../ledger.ts";
import type { ManifestStep } from "../../manifest/manifest.ts";
import { createServingRoster } from "../../serving-roster/index.ts";
import {
  IMAGE_CODE_STEPS_COMMAND,
  createUpgradeGate,
  imageCodeStepsDrift,
  imageGateSteps,
  readImageCodeSteps,
  servingImageTree,
} from "../index.ts";

const BLOCKING: ManifestStep = {
  id: "identity:reopen-unproven-accounts",
  kind: "data",
  mode: "blocking",
  owner: "identity",
  description: "Reopens accounts whose proof never landed.",
};
const BACKGROUND: ManifestStep = {
  id: "user:record-created-facts",
  kind: "data",
  mode: "background",
  owner: "user",
  description: "Records every existing user as user's fact.",
};

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function listFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), "image-code-steps-test-"));
  scratch.push(directory);
  const file = join(directory, "code-steps.json");
  writeFileSync(file, text);
  return file;
}

describe("imageCodeStepsDrift", () => {
  describe("when the fresh collection adds a step and changes another's mode", () => {
    /** @scenario "A stale code step list fails the check, naming each step that differs and the fix" */
    it("names the added and the changed step", () => {
      const drift = imageCodeStepsDrift({
        committed: [BLOCKING],
        collected: [{ ...BLOCKING, mode: "background" }, BACKGROUND],
      });

      expect(drift).toEqual([
        `changed: ${BLOCKING.id}`,
        `added: ${BACKGROUND.id} (background data)`,
      ]);
      expect(IMAGE_CODE_STEPS_COMMAND).toContain("packages/upgrade/scripts/image-code-steps.ts");
    });
  });

  describe("when the committed list equals the fresh collection", () => {
    /** @scenario "A fresh code step list passes the check" */
    it("names nothing", () => {
      expect(
        imageCodeStepsDrift({
          committed: [BLOCKING, BACKGROUND],
          collected: [BLOCKING, BACKGROUND],
        }),
      ).toEqual([]);
    });
  });
});

describe("readImageCodeSteps", () => {
  describe("when a step in the file has no mode", () => {
    /** @scenario "A code step list that is not a list of steps is refused by name" */
    it("refuses with invalid_manifest, naming the file", () => {
      const { mode: _mode, ...modeless } = BLOCKING;
      const file = listFile(JSON.stringify([modeless]));

      expect(() => readImageCodeSteps({ file })).toThrow(
        expect.objectContaining({
          code: "invalid_manifest",
          message: expect.stringContaining(file),
        }),
      );
    });
  });
});

describe("servingImageTree", () => {
  describe("when the generated list holds a blocking and a background step", () => {
    function gateOver({ blockingDone }: { blockingDone: boolean }) {
      const tree = servingImageTree({
        codeStepsFile: listFile(JSON.stringify([BLOCKING, BACKGROUND])),
      });
      const { blockingSteps, declaredSteps } = imageGateSteps({ tree, withClickHouse: true });
      const rows = new Map<string, ServingRosterEntry>();
      const roster = createServingRoster({
        ledger: {
          writeRosterEntry: async (declaration) => {
            const at = new Date(0);
            const row = {
              ...declaration,
              steps: [...declaration.steps],
              credentialKeys: [...(declaration.credentialKeys ?? [])],
              startedAt: at,
              heartbeatAt: at,
            };
            rows.set(row.processId, row);
            return row;
          },
          findLiveRoster: async () => [...rows.values()],
          removeRosterEntry: async ({ processId }) => void rows.delete(processId),
        },
        staleAfterMs: 60_000,
        refreshEveryMs: 15_000,
      });
      const done = blockingSteps.filter((id) => blockingDone || id !== BLOCKING.id);
      const gate = createUpgradeGate({
        role: "worker",
        processId: "worker-1",
        image: { name: "3.21.0", release: "3.21.0", blockingSteps, declaredSteps },
        ledger: {
          findSteps: async () =>
            [...done, ...declaredSteps].map((id) => ({
              id,
              kind: "data" as const,
              status: "done" as const,
              mode: "blocking" as const,
              release: null,
            })),
          findRuns: async () => [],
        },
        roster,
        schemaIsEmpty: async () => false,
      });
      return { gate, rows };
    }

    /** @scenario "The gate reads the image's generated code step list" */
    it("requires the blocking step and declares the background step on its roster entry", async () => {
      const behind = gateOver({ blockingDone: false });
      await expect(behind.gate.admit()).resolves.toMatchObject({
        admitted: false,
        outstanding: [BLOCKING.id],
      });

      const current = gateOver({ blockingDone: true });
      await expect(current.gate.admit()).resolves.toMatchObject({ admitted: true });
      expect(current.rows.get("worker-1")?.steps).toEqual([BACKGROUND.id]);
      await current.gate.release();
    });
  });
});
