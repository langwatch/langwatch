/**
 * @see specs/upgrade/upgrade-command.feature
 */
import { type ClickHouseClient, ClickHouseError } from "@clickhouse/client";
import { SecretsChain } from "@langwatch/secrets";
import type { UpgradePostgres } from "@langwatch/upgrade";
import { describe, expect, it } from "vitest";

import { resolveTasksConfig, type TaskInput, type TasksDatabase } from "../config.ts";
import { parseUpgradeArgs, runUpgradeCommand, sqlReader, withLockTimeout } from "../upgrade.ts";

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

/** A ClickHouse client whose every query fails with the server error given. */
function failingClient({ code, type }: { code: string; type: string }) {
  const query: ClickHouseClient["query"] = () =>
    Promise.reject(new ClickHouseError({ message: `${type} from the server`, code, type }));
  return { query };
}

describe("the upgrade's ClickHouse reader", () => {
  /** @scenario "A ClickHouse database goose has not created yet reads as holding no goose history" */
  it("reads a database that does not exist yet as empty and fails on any other server error", async () => {
    const missing = sqlReader({ client: failingClient({ code: "81", type: "UNKNOWN_DATABASE" }) });
    await expect(missing.queryRows("SELECT 1")).resolves.toEqual([]);

    const denied = sqlReader({ client: failingClient({ code: "497", type: "ACCESS_DENIED" }) });
    await expect(denied.queryRows("SELECT 1")).rejects.toMatchObject({ code: "497" });
  });
});
