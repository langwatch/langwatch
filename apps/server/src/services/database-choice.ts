import type { PromptObject } from "prompts";

import {
  DATABASES,
  databaseEnvValues,
  redactUrl,
  type DatabaseChoice,
  type DatabaseId,
} from "../shared/databases.ts";
import { setEnvValues } from "../shared/env.ts";
import type { PortAllocation } from "../shared/ports.ts";
import type { ProbeResult } from "./database-probe.ts";

/** One question at a time, answered by name: `prompts` in the CLI, a script in tests. */
export type Ask = (question: PromptObject) => Promise<Record<string, unknown>>;
export type Probe = (target: { id: DatabaseId; url: string }) => Promise<ProbeResult>;

const ALL_BUNDLED: DatabaseChoice = {
  postgres: { kind: "bundled" },
  redis: { kind: "bundled" },
  clickhouse: { kind: "bundled" },
};

/** Asked on the first run and on `--databases`; every other run keeps what the .env says. */
export function shouldAskDatabases({
  isFirstRun,
  isRequested,
}: {
  isFirstRun: boolean;
  isRequested: boolean;
}): boolean {
  return isFirstRun || isRequested;
}

/**
 * One question first (bundled, the default, or my own), then per database. A URL the person
 * brings is connected to before it is accepted; a refusal names the reason and asks again.
 * Without a person to ask (--yes, CI, no terminal) every database runs bundled.
 */
export async function chooseDatabases({
  isInteractive,
  ask,
  probe,
}: {
  isInteractive: boolean;
  ask: Ask;
  probe: Probe;
}): Promise<DatabaseChoice> {
  if (!isInteractive) return ALL_BUNDLED;
  const { mode } = await ask({
    type: "select",
    name: "mode",
    message: "How should LangWatch run its databases?",
    choices: [
      { title: "Bundled: downloaded and run inside ~/.langwatch", value: "bundled" },
      { title: "Use my own", value: "own" },
    ],
    initial: 0,
  });
  if (mode !== "own") return ALL_BUNDLED;
  const choice: DatabaseChoice = { ...ALL_BUNDLED };
  for (const { id, label } of DATABASES) {
    choice[id] = await chooseOne({ id, label, ask, probe });
  }
  return choice;
}

async function chooseOne({
  id,
  label,
  ask,
  probe,
}: {
  id: DatabaseId;
  label: string;
  ask: Ask;
  probe: Probe;
}): Promise<DatabaseChoice[DatabaseId]> {
  const { source } = await ask({
    type: "select",
    name: "source",
    message: `${label}: your own, or bundled?`,
    choices: [
      { title: `My own ${label}`, value: "own" },
      { title: `Bundled ${label}`, value: "bundled" },
    ],
    initial: 0,
  });
  if (source !== "own") return { kind: "bundled" };
  // Masked while typed: the URL usually carries the password.
  const { url } = await ask({
    type: "password",
    name: "url",
    message: `${label} URL`,
    validate: async (value: string) => {
      const typed = value.trim();
      const result = await probe({ id, url: typed });
      return result.ok
        ? true
        : `Could not connect to ${label} at ${redactUrl(typed)}: ${result.reason}`;
    },
  });
  return { kind: "own", url: String(url).trim() };
}

/** Saves the choice as the .env's database URLs; bundled data under ~/.langwatch/data stays. */
export function saveDatabaseChoice({
  envFile,
  ports,
  choice,
}: {
  envFile: string;
  ports: PortAllocation;
  choice: DatabaseChoice;
}): void {
  setEnvValues({ path: envFile, values: databaseEnvValues({ choice, ports }) });
}
