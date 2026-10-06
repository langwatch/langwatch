/**
 * @see specs/upgrade/upgrade-command.feature
 */
import { SecretsChain } from "@langwatch/secrets";
import type { UpgradePostgres } from "@langwatch/upgrade";
import { describe, expect, it } from "vitest";

import { resolveTasksConfig, type TaskInput, type TasksDatabase } from "../config.ts";
import { parseUpgradeArgs, runUpgradeCommand, withLockTimeout } from "../upgrade.ts";

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
    });
    expect(exitCode).toBe(0);
    const printed = JSON.parse(written.join(""));
    expect(printed).toMatchObject({ installed: null, plan: { outcome: "planned", fresh: true } });
  });
});
