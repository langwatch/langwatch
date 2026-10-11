/**
 * The worker runs the upgrade in its own process (Alex, 2026-10-11, slice 2): the installed modules
 * booted in the tasks role give the declared steps and the module work after the schema, and the
 * runner's outcome goes straight to the gate. Spec: specs/upgrade/entry-points.feature.
 */
import { spawn } from "node:child_process";

import type { EventUpcastReader } from "@langwatch/eventing";
import pg from "pg";

import {
  type ImageUpgradeInputs,
  runImageUpgrade,
  upcastStepsOf,
  upgradeRunnerLog,
} from "../runner/image-upgrade.ts";
import type { UpgradeReconciler } from "../runner/schema-applier.ts";
import { isDeclaredMigrationStep } from "../step/migration-step.ts";
import {
  type FirstInstallUpgrade,
  TASKS_APP_DIRECTORY,
  type UpgradeRunResult,
} from "./first-install-upgrade.ts";

/** A module task as the upgrade runs one: found by its name, run with no arguments. */
export interface UpgradeModuleTask {
  readonly name: string;
  run(input: { args: readonly string[]; signal: AbortSignal }): Promise<void>;
}

const isModuleTask = (contribution: unknown): contribution is UpgradeModuleTask =>
  typeof contribution === "object" &&
  contribution !== null &&
  "name" in contribution &&
  typeof contribution.name === "string" &&
  "run" in contribution &&
  typeof contribution.run === "function";

/** The installed modules booted in the tasks role, as the in-process upgrade reads them. */
export interface UpgradeModules {
  migrationSteps<Step extends { readonly id: string }>(
    isStep: (contribution: unknown) => contribution is Step,
  ): readonly Step[];
  upcastReader(): Pick<EventUpcastReader, "findActiveUpcasts"> | undefined;
  tasks<Task>(isTask: (contribution: unknown) => contribution is Task): readonly Task[];
  runListedWork<Result>(input: {
    name: string;
    timeoutMs: number;
    work: () => Promise<Result>;
  }): Promise<Result>;
}

/** Boots the installed list in the tasks role, hands it to `use`, and closes it after. */
export type BootUpgradeModules = <Result>(
  use: (modules: UpgradeModules) => Promise<Result>,
) => Promise<Result>;

/** Ops' task that asks a worker for one system-migrations pass once the run has finished. */
export const PASS_REQUEST_TASK = "request-system-migrations-pass";

/** How long the run waits for the pass request's queue jobs, which run ahead of any backlog. */
export const PASS_REQUEST_WAIT_MS = 60_000;

/**
 * The pass request with its queue jobs ahead of any backlog (T6: it sat behind 800k jobs). One that
 * does not settle in time is a warning: the hourly re-drive still reaches every tenant step.
 */
export function passRequestReconciler({
  modules,
}: {
  modules: Pick<UpgradeModules, "tasks" | "runListedWork">;
}): UpgradeReconciler {
  return {
    name: "system-migrations-pass-request",
    async run({ signal }) {
      const task = modules.tasks(isModuleTask).find((each) => each.name === PASS_REQUEST_TASK);
      if (!task) return;
      try {
        await modules.runListedWork({
          name: `task:${PASS_REQUEST_TASK}`,
          timeoutMs: PASS_REQUEST_WAIT_MS,
          work: () => task.run({ args: [], signal }),
        });
      } catch (error) {
        signal.throwIfAborted();
        upgradeRunnerLog().warn(
          "the system-migrations pass request did not settle; the hourly re-drive runs it",
          {
            phase: "reconcile",
            error: error instanceof Error ? error.message : String(error),
            next: "nothing to do: tenant steps settle at the next re-drive",
          },
        );
      }
    },
  };
}

/**
 * LangWatchQL provisioning, run as the tasks app's program under this run's lease (it is not a
 * module task); a refusal fails the run, as it did when the tasks app ran the upgrade.
 */
export function langWatchQlReconciler({
  environment,
  command = "pnpm",
  args = ["--silent", "task", "upgrade", "lwql-provision"],
}: {
  environment: ImageUpgradeInputs["environment"];
  command?: string;
  args?: readonly string[];
}): UpgradeReconciler {
  return {
    name: "langwatchql",
    run: ({ signal }) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, [...args], {
          cwd: TASKS_APP_DIRECTORY,
          stdio: "inherit",
          env: { ...environment },
          signal,
        });
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`LangWatchQL provisioning exited with code ${code ?? "none"}`)),
        );
      }),
  };
}

/** The runner's own connection: the ledger's schema, no statement timeout, a small pool. */
export function runnerPoolConfig({ databaseUrl }: { databaseUrl: string }): pg.PoolConfig {
  const schema = URL.canParse(databaseUrl) ? new URL(databaseUrl).searchParams.get("schema") : null;
  return {
    connectionString: databaseUrl,
    max: 4,
    allowExitOnIdle: true,
    options: schema ? `-c search_path="${schema}" -c TimeZone=UTC` : "-c TimeZone=UTC",
  };
}

/**
 * One upgrade run in this process: boots the installed modules, runs the image's upgrade over them
 * and answers the runner's outcome. A boot or connection failure answers `failed` with its message.
 */
export function inProcessUpgrade({
  boot,
  databaseUrl,
  environment,
  development,
  publish,
  signal = new AbortController().signal,
}: {
  boot: BootUpgradeModules;
  databaseUrl: string;
  environment: ImageUpgradeInputs["environment"];
  development: boolean;
  publish?: ImageUpgradeInputs["publish"];
  signal?: AbortSignal;
}): FirstInstallUpgrade {
  return async (): Promise<UpgradeRunResult> => {
    const pool = new pg.Pool(runnerPoolConfig({ databaseUrl }));
    try {
      const outcome = await boot((modules) =>
        runImageUpgrade({
          inputs: {
            postgres: pool,
            databaseUrl,
            environment,
            development,
            steps: modules.migrationSteps(isDeclaredMigrationStep),
            upcasts: upcastStepsOf({ app: modules }),
            reconcilers: [
              langWatchQlReconciler({ environment }),
              passRequestReconciler({ modules }),
            ],
            ...(publish ? { publish } : {}),
          },
          signal,
        }),
      );
      return { code: outcome.code, logTail: [outcome.message] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      upgradeRunnerLog().warn(`the upgrade could not run in this process: ${message}`, {
        phase: "preflight",
        next: "fix what the error names; this worker tries again",
      });
      return { code: "failed", logTail: [message] };
    } finally {
      await pool.end();
    }
  };
}
