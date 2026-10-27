/**
 * @see specs/upgrade/upgrade-command.feature
 */
import { SecretsChain } from "@langwatch/secrets";
import type { UpgradePostgres } from "@langwatch/upgrade";
import { withLockTimeout } from "@langwatch/upgrade/runner";
import { defineMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { resolveTasksConfig, type TaskInput, type TasksDatabase } from "../config.ts";
import { type DeclaredCodeSteps, parseUpgradeArgs, runUpgradeCommand } from "../upgrade.ts";

/** No module declares a step: the command never boots the tasks process. */
const noCodeSteps: DeclaredCodeSteps = (use) => use({ steps: [] });

/** A database with no ledger and no Prisma history: every presence probe finds nothing. */
const emptyDatabase: UpgradePostgres = {
  query: async () => ({ rows: [] }),
};

function inputOver({ sql }: { sql: UpgradePostgres }): TaskInput {
  const database: TasksDatabase = {
    get client(): never {
      throw new Error("the upgrade command reads the ledger through sql only");
    },
    sql,
    hold: async (run) => run(),
    close: async () => {},
  };
  return {
    config: resolveTasksConfig({ NODE_ENV: "test" }),
    connections: { database, redis: null },
    chain: SecretsChain.start({ environment: {} }),
    environment: {},
    signal: new AbortController().signal,
  };
}

describe("withLockTimeout()", () => {
  /** @scenario "The Postgres session of a migration carries a lock timeout" */
  it("sets lock_timeout and keeps the session options already present", () => {
    const plain = new URL(
      withLockTimeout({ url: "postgresql://db:5432/app", lockTimeoutMs: 10_000 }),
    );
    expect(plain.searchParams.get("options")).toBe("-c lock_timeout=10000");

    const withOptions = new URL(
      withLockTimeout({
        url: "postgresql://db:5432/app?schema=public&options=-c%20search_path%3Dapp",
        lockTimeoutMs: 5_000,
      }),
    );
    expect(withOptions.searchParams.get("options")).toBe("-c search_path=app -c lock_timeout=5000");
    expect(withOptions.searchParams.get("schema")).toBe("public");
  });
});

describe("the upgrade subcommands", () => {
  /** @scenario "upgrade status and upgrade plan print the reader's and the planner's output" */
  it("parses status and plan, takes --json, and refuses anything else by name", async () => {
    expect(parseUpgradeArgs({ args: [] })).toEqual({ command: "run" });
    expect(parseUpgradeArgs({ args: ["status"] })).toEqual({ command: "status", json: false });
    expect(parseUpgradeArgs({ args: ["plan", "--json"] })).toEqual({ command: "plan", json: true });
    expect(() => parseUpgradeArgs({ args: ["migrate"] })).toThrow(
      expect.objectContaining({ code: "unknown_upgrade_argument", argument: "migrate" }),
    );
    expect(() => parseUpgradeArgs({ args: ["plan", "--yes"] })).toThrow(
      expect.objectContaining({ code: "unknown_upgrade_argument", argument: "--yes" }),
    );

    const written: string[] = [];
    const exitCode = await runUpgradeCommand({
      args: ["plan", "--json"],
      input: inputOver({ sql: emptyDatabase }),
      write: (text) => written.push(text),
      codeSteps: noCodeSteps,
    });
    expect(exitCode).toBe(0);
    const printed = JSON.parse(written.join(""));
    expect(printed).toMatchObject({ installed: null, plan: { outcome: "planned", fresh: true } });
  });

  /** @scenario "upgrade plan --to names the release to preview, and nothing else takes it" */
  it("parses plan --to <release> and refuses --to without a release or on status", () => {
    expect(parseUpgradeArgs({ args: ["plan", "--to", "3.22.0", "--json"] })).toEqual({
      command: "plan",
      json: true,
      to: "3.22.0",
    });
    expect(() => parseUpgradeArgs({ args: ["plan", "--to"] })).toThrow(
      expect.objectContaining({ code: "unknown_upgrade_argument", argument: "--to" }),
    );
    expect(() => parseUpgradeArgs({ args: ["plan", "--to", "latest"] })).toThrow(
      expect.objectContaining({ code: "unknown_upgrade_argument", argument: "--to latest" }),
    );
    expect(() => parseUpgradeArgs({ args: ["status", "--to", "3.22.0"] })).toThrow(
      expect.objectContaining({ code: "unknown_upgrade_argument", argument: "--to" }),
    );
  });

  /** @scenario "The upgrade task runs the code steps every installed module declares" */
  it("plans the installed modules' declared steps and closes the process that built them", async () => {
    const step = defineMigrationStep({
      id: "identity:reopen-unproven-accounts",
      kind: "data",
      mode: "background",
      description: "Reopens accounts that never proved their address.",
      run: async () => ({}),
    });
    const events: string[] = [];
    const declared: DeclaredCodeSteps = async (use) => {
      events.push("booted");
      try {
        return await use({ steps: [step] });
      } finally {
        events.push("closed");
      }
    };
    const written: string[] = [];
    const exitCode = await runUpgradeCommand({
      args: ["plan", "--json"],
      input: inputOver({ sql: emptyDatabase }),
      write: (text) => written.push(text),
      codeSteps: declared,
    });
    expect(exitCode).toBe(0);
    expect(written.join("")).toContain("identity:reopen-unproven-accounts");
    expect(events).toEqual(["booted", "closed"]);
  });
});

describe("the upgrade task's run", () => {
  /** @scenario "pnpm task upgrade runs the upgrade as a run-once worker and answers its exit code" */
  it("hands the run to the worker started once and answers the worker's exit code", async () => {
    const started: TaskInput[] = [];
    const input = inputOver({ sql: emptyDatabase });
    const exitCode = await runUpgradeCommand({
      args: [],
      input,
      codeSteps: noCodeSteps,
      runOnce: async (given) => {
        started.push(given);
        return 3;
      },
    });

    expect(exitCode).toBe(3);
    expect(started).toEqual([input]);
  });

  /** @scenario "The worker's upgrade provisions LangWatchQL through the tasks app under its own lease" */
  it("parses lwql-provision and refuses an argument after it", () => {
    expect(parseUpgradeArgs({ args: ["lwql-provision"] })).toEqual({ command: "lwql-provision" });
    expect(() => parseUpgradeArgs({ args: ["lwql-provision", "--now"] })).toThrow(
      expect.objectContaining({ code: "unknown_upgrade_argument", argument: "--now" }),
    );
  });
});
