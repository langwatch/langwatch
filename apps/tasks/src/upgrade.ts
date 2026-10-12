import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";

import type { UpcastStepInput, UpgradePostgres } from "@langwatch/upgrade";
import { loadReleases, releaseVersionSchema } from "@langwatch/upgrade/manifest";
import { formatStatus, preflightFrom, previewUpgradeTo } from "@langwatch/upgrade/reader";
import {
  formatPlan,
  upcastStepsOf,
  type UpgradeRunner,
  withImageUpgradeRunner,
} from "@langwatch/upgrade/runner";
import { assertOldWritersGone, recordPreRosterRollback } from "@langwatch/upgrade/serving-roster";
import {
  isDeclaredMigrationStep,
  type MigrationStep,
  type TenantMigrationStep,
} from "@langwatch/upgrade/step";

import type { TaskInput } from "./config.ts";
import { lwqlProvision } from "./lwql-provision.ts";
import { withTasksApp } from "./module-task.ts";

/** Overrides for writers before the serving roster (Round 47 E2; ADR-173, amendment 2026-10-08). */
const PRE_ROSTER_COMMANDS = ["old-writers-gone", "pre-roster-rollback"] as const;
type PreRosterCommand = (typeof PRE_ROSTER_COMMANDS)[number];
const isPreRosterCommand = (argument: string): argument is PreRosterCommand =>
  (PRE_ROSTER_COMMANDS as readonly string[]).includes(argument);

export type UpgradeCommand =
  | { command: "run" }
  | { command: "lwql-provision" }
  | { command: "status"; json: boolean }
  | { command: "plan"; json: boolean; to?: string }
  | { command: PreRosterCommand };

/** An argument `upgrade` does not take; `code` is what a caller branches on. */
export class UpgradeArgumentError extends Error {
  readonly code = "unknown_upgrade_argument";
  constructor(readonly argument: string) {
    super(
      `upgrade takes no "${argument}". Use: upgrade | upgrade status [--json] | upgrade plan [--to <release>] [--json]` +
        " | upgrade steps [--json] [--out <file>] | upgrade old-writers-gone | upgrade pre-roster-rollback" +
        " | upgrade lwql-provision",
    );
    this.name = "UpgradeArgumentError";
  }
}

export function parseUpgradeArgs({ args }: { args: readonly string[] }): UpgradeCommand {
  const [first, ...rest] = args;
  if (first === undefined) return { command: "run" };
  if (first === "lwql-provision" || isPreRosterCommand(first)) {
    if (rest[0] !== undefined) throw new UpgradeArgumentError(rest[0]);
    return { command: first };
  }
  if (first !== "status" && first !== "plan") throw new UpgradeArgumentError(first);
  const toAt = first === "plan" ? rest.indexOf("--to") : -1;
  const to = toAt === -1 ? undefined : rest[toAt + 1];
  if (toAt !== -1 && !releaseVersionSchema.validate(to))
    throw new UpgradeArgumentError(`--to ${to ?? ""}`.trim());
  const flags = toAt === -1 ? rest : rest.toSpliced(toAt, 2);
  const unknown = flags.find((argument) => argument !== "--json");
  if (unknown !== undefined) throw new UpgradeArgumentError(unknown);
  const json = flags.includes("--json");
  if (first === "status") return { command: first, json };
  return to === undefined ? { command: first, json } : { command: first, json, to };
}

/**
 * Hands `use` the steps the installed modules declare and, where the process holds an event log,
 * their upcasts; then closes the process that built them.
 */
export type DeclaredCodeSteps = <Result>(
  use: (declared: {
    steps: readonly (MigrationStep | TenantMigrationStep)[];
    upcasts?: () => Promise<readonly UpcastStepInput[]>;
  }) => Promise<Result>,
) => Promise<Result>;

/** The tasks process's `.withMigrations` steps (round 14) and event upcasts (Alex, 2026-10-09). */
export const installedCodeSteps: DeclaredCodeSteps = (use) =>
  withTasksApp({
    use: (app) =>
      use({ steps: app.migrationSteps(isDeclaredMigrationStep), upcasts: upcastStepsOf({ app }) }),
  });

/**
 * `pnpm task upgrade [status | plan [--to <release>]] [--json]`
 * (specs/upgrade/upgrade-command.feature). Exit codes: 0 done, 1 failed, 3 lease not acquired.
 * The installed modules' code steps are booted first.
 */
export async function runUpgradeCommand({
  args,
  input,
  write = (text) => process.stdout.write(text),
  codeSteps = installedCodeSteps,
  runOnce = runWorkerUpgradeOnce,
}: {
  args: readonly string[];
  input: TaskInput;
  write?: (text: string) => void;
  codeSteps?: DeclaredCodeSteps;
  /** The run itself: the worker, started to run the upgrade once (Alex, 2026-10-11, slice 2). */
  runOnce?: (input: TaskInput) => Promise<number>;
}): Promise<number> {
  const command = parseUpgradeArgs({ args });
  if (command.command === "run") return runOnce(input);
  if (command.command === "lwql-provision") {
    await lwqlProvision({ ...input, failOnError: true });
    return 0;
  }
  const database = input.connections.database;
  if (!database) throw new Error("DATABASE_URL is required to upgrade");
  if (command.command === "old-writers-gone" || command.command === "pre-roster-rollback") {
    return runPreRosterCommand({ command: command.command, postgres: database.sql, write });
  }
  return codeSteps(({ steps, upcasts }) =>
    withImageUpgradeRunner({
      inputs: {
        postgres: database.sql,
        databaseUrl: input.environment.DATABASE_URL,
        environment: input.environment,
        development: input.config.nodeEnvironment === "development",
        steps,
        ...(upcasts === undefined ? {} : { upcasts }),
      },
      use: ({ runner, release }) => printRead({ command, runner, release, write }),
    }),
  );
}

/** `upgrade status` or `upgrade plan`: reads only, never a run. */
async function printRead({
  command,
  runner,
  release,
  write,
}: {
  command: UpgradeCommand;
  runner: Pick<UpgradeRunner, "plan" | "status">;
  release: string | null;
  write: (text: string) => void;
}): Promise<number> {
  if (command.command === "status") {
    const status = await runner.status();
    write(`${command.json ? JSON.stringify(status, null, 2) : formatStatus({ status })}\n`);
  }
  if (command.command === "plan") await printPlan({ command, runner, image: { release }, write });
  return 0;
}

/** The image's worker app, which runs the upgrade once when started with `upgrade`. */
export const WORKER_APP_DIRECTORY = fileURLToPath(new URL("../../worker/", import.meta.url));

/**
 * `pnpm task upgrade` is a run-once worker: it starts the worker to run the upgrade in-process and
 * answers its exit code, 0 done, 1 failed, 3 lease not acquired. Spec: entry-points.feature.
 */
export function runWorkerUpgradeOnce(
  input: Pick<TaskInput, "environment" | "signal">,
  { cwd = WORKER_APP_DIRECTORY, command = "pnpm", args = ["--silent", "start", "upgrade"] } = {},
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...input.environment },
      signal: input.signal,
    });
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

/** Records one override for writers before the roster; no lease and no module boot. Exit 0. */
export async function runPreRosterCommand({
  command,
  postgres,
  write,
  actor = `pnpm task upgrade ${command} on ${hostname()}`,
}: {
  command: PreRosterCommand;
  postgres: UpgradePostgres;
  write: (text: string) => void;
  actor?: string;
}): Promise<number> {
  if (command === "old-writers-gone") {
    const { recordedAt } = await assertOldWritersGone({ postgres, actor });
    write(
      `old writers before the serving roster asserted gone at ${recordedAt.toISOString()}: ` +
        "steps that wait for old writers run once every live process declares them\n",
    );
    return 0;
  }
  const { recordedAt, reopened } = await recordPreRosterRollback({ postgres, actor });
  write(
    `rollback to an image before the serving roster recorded at ${recordedAt.toISOString()}; ` +
      `reopened: ${reopened.length > 0 ? reopened.join(", ") : "none"}. Steps that wait for old ` +
      "writers hold until `pnpm task upgrade old-writers-gone` runs after the next rollout, or " +
      "until the grace after the next upgrade run\n",
  );
  return 0;
}

/** `upgrade plan` prints the plan; with `--to`, the plan narrowed to it and the preflight. */
async function printPlan({
  command,
  runner,
  image,
  write,
}: {
  command: Extract<UpgradeCommand, { command: "plan" }>;
  runner: Pick<UpgradeRunner, "plan" | "status">;
  image: { release: string | null };
  write: (text: string) => void;
}): Promise<void> {
  const planned = await runner.plan();
  if (command.to === undefined) {
    write(`${command.json ? JSON.stringify(planned, null, 2) : formatPlan(planned)}\n`);
    return;
  }
  const preview = {
    installed: planned.installed,
    plan: previewUpgradeTo({
      plan: planned.plan,
      image,
      manifests: loadReleases().manifests,
      to: command.to,
    }),
    preflight: preflightFrom({ status: await runner.status() }),
  };
  write(`${command.json ? JSON.stringify(preview, null, 2) : formatPreview(preview)}\n`);
}

/** `upgrade plan --to` as text: the narrowed plan, then one line per preflight row. */
export function formatPreview({
  installed,
  plan,
  preflight,
}: {
  installed: string | null;
  plan: ReturnType<typeof previewUpgradeTo>;
  preflight: ReturnType<typeof preflightFrom>;
}): string {
  const head =
    plan.outcome === "refused"
      ? `Refused (${plan.code}): ${plan.message}`
      : formatPlan({ installed, plan });
  const rows = preflight.map((row) =>
    [`  ${row.outcome}: ${row.name}`, row.detail, row.fix && `fix: ${row.fix}`]
      .filter(Boolean)
      .join("; "),
  );
  return [head, "Preflight:", ...rows].join("\n");
}

/** The registry's `upgrade` task: runs the upgrade and leaves its exit code for the process. */
export async function upgrade(input: TaskInput): Promise<void> {
  const exitCode = await runUpgradeCommand({ args: [], input });
  if (exitCode !== 0) process.exitCode = exitCode;
}
