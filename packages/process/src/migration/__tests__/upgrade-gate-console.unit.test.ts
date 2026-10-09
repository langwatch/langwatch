/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { createHash } from "node:crypto";

import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import type { UpgradeConsole } from "../../lifecycle/liveness-thread.ts";
import { type UpgradeGateVerdict, upgradeGateComponent } from "../upgrade-gate.ts";

const HOLDING = { phase: "upgrade-gate", outstandingStepIds: [] };
const PINO_WARN = 40;

const failedAt = (id: string): UpgradeGateVerdict => ({
  admitted: false,
  refusal: "behind this image",
  failedRun: { failedSteps: [{ id, error: `${id} broke` }], logTail: [`${id} failed`] },
});

function hostGate({
  verdicts,
  onFailed,
}: {
  verdicts: UpgradeGateVerdict[];
  onFailed: (upgradeConsole: UpgradeConsole) => Promise<boolean>;
}) {
  const { logger, lines } = createTestLogger();
  const admit = vi.fn(
    async (): Promise<UpgradeGateVerdict> => verdicts.shift() ?? { admitted: true },
  );
  const onHolding = vi.fn(async () => undefined);
  const hosted = upgradeGateComponent({
    server: "console-test",
    role: "api",
    gate: { admit, release: async () => undefined },
    logger,
    onHolding,
    onFailed,
  });
  const tokens = () =>
    lines
      .map((line) => /valid once for \d+ minutes: ([\w-]+)/.exec(JSON.stringify(line))?.[1])
      .filter((token) => token !== undefined);
  return { hosted, lines, admit, onHolding, tokens };
}

describe("the upgrade gate's console", () => {
  describe("given the api's upgrade run fails", () => {
    /** @scenario "A failed upgrade keeps the api holding the door and prints a console token to its log" */
    it("keeps holding, prints one token on one line and hands the console only its hash", async () => {
      const consoles: UpgradeConsole[] = [];
      const { hosted, lines, onHolding, tokens } = hostGate({
        verdicts: [failedAt("dataset:move")],
        onFailed: (upgradeConsole) => {
          consoles.push(upgradeConsole);
          return new Promise<boolean>(() => undefined);
        },
      });

      void hosted.start?.();
      await vi.waitFor(() => expect(consoles).toHaveLength(1));
      const token = tokens()[0] ?? "no token printed";

      expect(onHolding.mock.calls).toEqual([[HOLDING]]);
      expect(createHash("sha256").update(token).digest("hex")).toBe(consoles[0]?.tokenSha256);
      const tokenLines = lines.filter((line) => JSON.stringify(line).includes(token));
      expect(tokenLines).toHaveLength(1);
      expect(tokenLines[0]?.level).toBe(PINO_WARN);
      expect(JSON.stringify(tokenLines[0])).toContain("kubectl port-forward pod/");
      expect(JSON.stringify(consoles)).not.toContain(token);
      expect(consoles[0]?.failedSteps).toEqual([
        { id: "dataset:move", error: "dataset:move broke" },
      ]);
    });

    /** @scenario "The console shows a failed run's errors and log lines with connection passwords redacted" */
    it("redacts a connection URL's password in the step errors and log lines it hands the console", async () => {
      const consoles: UpgradeConsole[] = [];
      const leaked = "postgres://langwatch:s3cret-pw@db:5432/langwatch";
      const { hosted } = hostGate({
        verdicts: [
          {
            admitted: false,
            refusal: "behind this image",
            failedRun: {
              failedSteps: [
                { id: "a:url", error: `could not reach ${leaked}` },
                { id: "b:none", error: null },
              ],
              logTail: [`[upgrade] connecting to ${leaked}`, "[upgrade] plain line"],
            },
          },
        ],
        onFailed: async (upgradeConsole) => {
          consoles.push(upgradeConsole);
          return false;
        },
      });

      await expect(hosted.start?.()).rejects.toThrow("refuses to serve");

      expect(JSON.stringify(consoles)).not.toContain("s3cret-pw");
      expect(consoles[0]?.failedSteps).toEqual([
        { id: "a:url", error: "could not reach postgres://langwatch:***@db:5432/langwatch" },
        { id: "b:none", error: null },
      ]);
      expect(consoles[0]?.logTail).toEqual([
        "[upgrade] connecting to postgres://langwatch:***@db:5432/langwatch",
        "[upgrade] plain line",
      ]);
    });

    it("refuses as before when there is no console to show, and runs nothing again", async () => {
      const { hosted, admit } = hostGate({
        verdicts: [failedAt("dataset:move")],
        onFailed: async () => false,
      });

      await expect(hosted.start?.()).rejects.toThrow("refuses to serve");
      expect(admit).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an operator presses Retry in the console", () => {
    /** @scenario "Retry from the console runs the upgrade again and serves on success" */
    it("holds the upgrading page again, asks again and serves once admitted", async () => {
      const { hosted, admit, onHolding } = hostGate({
        verdicts: [failedAt("dataset:move"), { admitted: true }],
        onFailed: async () => true,
      });

      await hosted.start?.();

      expect(admit).toHaveBeenCalledTimes(2);
      expect(onHolding.mock.calls).toEqual([[HOLDING], [HOLDING], [undefined]]);
    });

    /** @scenario "A retry that fails again keeps the console and names the new failure" */
    it("shows the new failure under a new token", async () => {
      const consoles: UpgradeConsole[] = [];
      const { hosted, tokens } = hostGate({
        verdicts: [failedAt("a:first"), failedAt("b:second"), { admitted: true }],
        onFailed: async (upgradeConsole) => {
          consoles.push(upgradeConsole);
          return true;
        },
      });

      await hosted.start?.();

      expect(consoles.map(({ failedSteps }) => failedSteps[0]?.id)).toEqual([
        "a:first",
        "b:second",
      ]);
      expect(new Set(tokens()).size).toBe(2);
    });
  });
});
