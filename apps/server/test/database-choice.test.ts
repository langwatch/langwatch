import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PromptObject } from "prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseDatabases,
  saveDatabaseChoice,
  shouldAskDatabases,
  type Probe,
} from "../src/services/database-choice.ts";
import { ownDatabases } from "../src/shared/databases.ts";
import { buildEnv } from "../src/shared/env.ts";
import { allocatePorts } from "../src/shared/ports.ts";

const ports = allocatePorts(5560);
const OWN_POSTGRES = "postgresql://me:secret@db.internal:5432/langwatch";
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lw-databases-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Answers each question in turn from `answers`, keeping every question it was asked. */
function scriptedAsk(answers: Record<string, unknown>[]) {
  const asked: PromptObject[] = [];
  const ask = vi.fn(async (question: PromptObject) => {
    asked.push(question);
    return answers.shift() ?? {};
  });
  return { ask, asked };
}

const reachable: Probe = async () => ({ ok: true });

function scaffoldedEnv(): string {
  const envFile = join(home, ".env");
  writeFileSync(envFile, buildEnv({ ports }));
  return envFile;
}

describe("the database question", () => {
  describe("when an interactive first run starts", () => {
    /** @scenario "The first interactive run asks once, with bundled as the default" */
    it("asks how to run the databases, bundled first and selected", async () => {
      const { ask, asked } = scriptedAsk([{ mode: "bundled" }]);

      await chooseDatabases({ isInteractive: true, ask, probe: reachable });

      expect(shouldAskDatabases({ isFirstRun: true, isRequested: false })).toBe(true);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({
        type: "select",
        initial: 0,
        choices: [{ value: "bundled" }, { value: "own" }],
      });
    });
  });

  describe("when they answer bundled", () => {
    /** @scenario "Choosing bundled runs all three inside ~/.langwatch" */
    it("asks nothing more and keeps every database URL bundled", async () => {
      const { ask, asked } = scriptedAsk([{ mode: "bundled" }]);
      const envFile = scaffoldedEnv();

      const choice = await chooseDatabases({ isInteractive: true, ask, probe: reachable });
      saveDatabaseChoice({ envFile, ports, choice });

      expect(asked).toHaveLength(1);
      expect(ownDatabases({ env: envOf(envFile), ports })).toEqual([]);
    });
  });

  describe("when they answer my own", () => {
    /** @scenario "Choosing my own asks per database" */
    it("asks for each of Postgres, Redis and ClickHouse in turn", async () => {
      const { ask, asked } = scriptedAsk([
        { mode: "own" },
        { source: "own" },
        { url: OWN_POSTGRES },
        { source: "bundled" },
        { source: "bundled" },
      ]);

      const choice = await chooseDatabases({ isInteractive: true, ask, probe: reachable });

      expect(asked.map((question) => question.message)).toEqual([
        "How should LangWatch run its databases?",
        "Postgres: your own, or bundled?",
        "Postgres URL",
        "Redis: your own, or bundled?",
        "ClickHouse: your own, or bundled?",
      ]);
      expect(choice).toEqual({
        postgres: { kind: "own", url: OWN_POSTGRES },
        redis: { kind: "bundled" },
        clickhouse: { kind: "bundled" },
      });
    });
  });

  describe("when they enter the URL of their own database", () => {
    /** @scenario "A database they bring is connected before it is saved" */
    it("connects before accepting it, and refuses one it cannot reach with the reason", async () => {
      const { ask, asked } = scriptedAsk([
        { mode: "own" },
        { source: "own" },
        { url: OWN_POSTGRES },
        { source: "bundled" },
        { source: "bundled" },
      ]);
      const probe = vi.fn<Probe>(async ({ url }) =>
        url === OWN_POSTGRES ? { ok: true } : { ok: false, reason: "connection refused" },
      );
      await chooseDatabases({ isInteractive: true, ask, probe });
      const validate = asked[2]?.validate as (value: string) => Promise<true | string>;

      expect(await validate("postgresql://nobody@nowhere:1/x")).toBe(
        "Could not connect to Postgres: connection refused",
      );
      expect(await validate(OWN_POSTGRES)).toBe(true);
      expect(probe).toHaveBeenCalledWith({ id: "postgres", url: OWN_POSTGRES });
    });
  });

  describe("when the install already answered", () => {
    /** @scenario "The answer is kept and not asked again" */
    it("does not ask again and reads the same databases from the .env", () => {
      const envFile = scaffoldedEnv();
      saveDatabaseChoice({
        envFile,
        ports,
        choice: {
          postgres: { kind: "own", url: OWN_POSTGRES },
          redis: { kind: "bundled" },
          clickhouse: { kind: "bundled" },
        },
      });

      expect(shouldAskDatabases({ isFirstRun: false, isRequested: false })).toBe(false);
      expect(ownDatabases({ env: envOf(envFile), ports })).toEqual(["postgres"]);
      expect(envOf(envFile).DATABASE_URL).toBe(OWN_POSTGRES);
    });
  });

  describe("when nobody can be asked", () => {
    /** @scenario "Non-interactive runs use bundled without asking" */
    it("uses bundled databases without a question", async () => {
      const { ask } = scriptedAsk([]);

      const choice = await chooseDatabases({ isInteractive: false, ask, probe: reachable });

      expect(ask).not.toHaveBeenCalled();
      expect(Object.values(choice).every((picked) => picked.kind === "bundled")).toBe(true);
    });
  });

  describe("when they ask to change it with --databases", () => {
    /** @scenario "The choice can be changed later" */
    it("asks again, replaces the saved URL and leaves the bundled data alone", async () => {
      const envFile = scaffoldedEnv();
      saveDatabaseChoice({
        envFile,
        ports,
        choice: {
          postgres: { kind: "own", url: OWN_POSTGRES },
          redis: { kind: "bundled" },
          clickhouse: { kind: "bundled" },
        },
      });
      const dataFile = join(home, "data", "postgres", "PG_VERSION");
      mkdirSync(join(home, "data", "postgres"), { recursive: true });
      writeFileSync(dataFile, "17");
      const { ask } = scriptedAsk([{ mode: "bundled" }]);

      expect(shouldAskDatabases({ isFirstRun: false, isRequested: true })).toBe(true);
      const choice = await chooseDatabases({ isInteractive: true, ask, probe: reachable });
      saveDatabaseChoice({ envFile, ports, choice });

      expect(ownDatabases({ env: envOf(envFile), ports })).toEqual([]);
      expect(readFileSync(dataFile, "utf8")).toBe("17");
    });
  });
});

function envOf(envFile: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(envFile, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}
