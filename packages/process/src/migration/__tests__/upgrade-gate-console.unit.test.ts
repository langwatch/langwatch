/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { createHash } from "node:crypto";

import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import type { UpgradeConsole } from "../../lifecycle/liveness-thread.ts";
import {
  type UpgradeGateFailedRun,
  type UpgradeGateVerdict,
  upgradeGateComponent,
} from "../upgrade-gate.ts";

const PINO_WARN = 40;
const SCHEMA_STEP = "prisma:20261009_add_column";

const failedRun = (id: string): UpgradeGateFailedRun => ({
  failedSteps: [{ id, error: `${id} broke` }],
  logTail: [`${id} failed`],
});

/** What the ledger answers an upgrading api: a schema step outstanding, maybe a failed install. */
const upgrading = (run?: UpgradeGateFailedRun): UpgradeGateVerdict => ({
  admitted: false,
  outcome: "upgrading",
  outstanding: [SCHEMA_STEP],
  ...(run ? { failedRun: run } : {}),
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
  const retryFailedSteps = vi.fn(async () => undefined);
  const onConsoleLifted = vi.fn(async () => undefined);
  const consoles: UpgradeConsole[] = [];
  const hosted = upgradeGateComponent({
    server: "console-test",
    role: "api",
    gate: { admit, release: async () => undefined, retryFailedSteps },
    logger,
    onConsoleLifted,
    onFailed: (upgradeConsole) => {
      consoles.push(upgradeConsole);
      return onFailed(upgradeConsole);
    },
    reAskMs: 1,
  });
  const tokens = () =>
    lines
      .map((line) => /valid once for \d+ minutes: ([\w-]+)/.exec(JSON.stringify(line))?.[1])
      .filter((token) => token !== undefined);
  return { hosted, lines, admit, onConsoleLifted, retryFailedSteps, consoles, tokens };
}

const never = () => new Promise<boolean>(() => undefined);

describe("the upgrade gate's console", () => {
  describe("given the ledger records a failed first install", () => {
    /** @scenario "A failed first install shows the console and prints a console token to its log" */
    it("shows the console, prints one token on one line and hands the console only its hash", async () => {
      const { hosted, lines, consoles, tokens } = hostGate({
        verdicts: [upgrading(failedRun(SCHEMA_STEP))],
        onFailed: never,
      });

      void hosted.start?.();
      await vi.waitFor(() => expect(consoles).toHaveLength(1));
      const token = tokens()[0] ?? "no token printed";

      expect(createHash("sha256").update(token).digest("hex")).toBe(consoles[0]?.tokenSha256);
      const tokenLines = lines.filter((line) => JSON.stringify(line).includes(token));
      expect(tokenLines).toHaveLength(1);
      expect(tokenLines[0]?.level).toBe(PINO_WARN);
      expect(JSON.stringify(tokenLines[0])).toContain("kubectl port-forward pod/");
      expect(JSON.stringify(consoles)).not.toContain(token);
      expect(consoles[0]?.failedSteps).toEqual([
        { id: SCHEMA_STEP, error: `${SCHEMA_STEP} broke` },
      ]);
    });

    /** @scenario "The console shows a failed run's errors and log lines with connection passwords redacted" */
    it("redacts a connection URL's password in the step errors and log lines it hands the console", async () => {
      const leaked = "postgres://langwatch:s3cret-pw@db:5432/langwatch";
      const { hosted, consoles } = hostGate({
        verdicts: [
          upgrading({
            failedSteps: [
              { id: "a:url", error: `could not reach ${leaked}` },
              { id: "b:none", error: null },
            ],
            logTail: [`[upgrade] connecting to ${leaked}`, "[upgrade] plain line"],
          }),
        ],
        onFailed: never,
      });

      void hosted.start?.();
      await vi.waitFor(() => expect(consoles).toHaveLength(1));

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

    it("keeps one console and one token while the ledger answers the same failure", async () => {
      const failure = failedRun(SCHEMA_STEP);
      const { hosted, admit, consoles, tokens } = hostGate({
        verdicts: [upgrading(failure), upgrading(failure), upgrading(failure)],
        onFailed: never,
      });

      void hosted.start?.();
      await vi.waitFor(() => expect(admit.mock.calls.length).toBeGreaterThan(3));

      expect(consoles).toHaveLength(1);
      expect(tokens()).toHaveLength(1);
    });
  });

  describe("given a failure on an installation that finished an upgrade before", () => {
    /** @scenario "A failure on an installation that finished an upgrade before opens no console" */
    it("serves without a console and prints no token", async () => {
      const { hosted, admit, consoles, tokens } = hostGate({
        verdicts: [upgrading(), upgrading()],
        onFailed: never,
      });

      await hosted.start?.();
      await vi.waitFor(() => expect(admit).toHaveBeenCalledTimes(3));

      expect(consoles).toHaveLength(0);
      expect(tokens()).toHaveLength(0);
    });
  });

  describe("given an operator presses Retry in the console", () => {
    /** @scenario "Retry from the console returns the failed step to pending and the api moves on when the worker's run succeeds" */
    it("returns the failed steps to pending in the ledger, then serves once the ledger is current", async () => {
      const { hosted, admit, onConsoleLifted, retryFailedSteps } = hostGate({
        verdicts: [upgrading(failedRun(SCHEMA_STEP)), upgrading()],
        onFailed: async () => true,
      });

      await hosted.start?.();
      await vi.waitFor(() => expect(onConsoleLifted).toHaveBeenCalled());

      expect(retryFailedSteps).toHaveBeenCalledTimes(1);
      expect(admit).toHaveBeenCalledTimes(3);
      expect(retryFailedSteps.mock.invocationCallOrder[0]).toBeLessThan(
        admit.mock.invocationCallOrder[1] ?? 0,
      );
      await expect(hosted.ready?.()).resolves.toBeUndefined();
    });

    /** @scenario "A retry that fails again keeps the console and names the new failure" */
    it("shows the new failure under a new token", async () => {
      const { hosted, consoles, tokens, retryFailedSteps } = hostGate({
        verdicts: [upgrading(failedRun("prisma:first")), upgrading(failedRun("prisma:first"))],
        onFailed: async () => true,
      });

      await hosted.start?.();
      await vi.waitFor(() => expect(retryFailedSteps).toHaveBeenCalledTimes(2));

      expect(consoles.map(({ failedSteps }) => failedSteps[0]?.id)).toEqual([
        "prisma:first",
        "prisma:first",
      ]);
      expect(new Set(tokens()).size).toBe(2);
      expect(retryFailedSteps).toHaveBeenCalledTimes(2);
    });
  });
});
