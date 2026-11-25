/**
 * The worker runs the upgrade in its own process (Alex, 2026-10-11, slice 2): the installed modules
 * booted in the tasks role give the declared steps and the module work after the schema, and the
 * runner's outcome goes straight to the gate. Spec: specs/upgrade/entry-points.feature.
 */
import { spawn } from "node:child_process";

import type { EventUpcastReader } from "@langwatch/eventing";
import { RedisConnectionService, RedisShutdownService } from "@langwatch/redis-client";
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
export const PASS_REQUEST_WAIT_MS = 5 * 60_000;

/**
 * The pass request with its queue jobs on a list ahead of any backlog (T6), which a consuming
 * worker runs: the serving worker sends it after it takes jobs (T0-F11). One that does not settle
 * in time is a warning: the hourly re-drive still reaches every tenant step.
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

/** Where one run publishes its read hints, closed when the run ends. */
export type ReadHintPublisher = Readonly<{
  publish: NonNullable<ImageUpgradeInputs["publish"]>;
  close: () => Promise<void>;
}>;

/** Opens a run's publisher; null where the process has no Redis, so the run publishes none. */
export type OpenReadHintPublisher = () => ReadHintPublisher | null;

/**
 * The worker's Redis, resolved as its stores resolve it (cluster endpoints over a URL, the dev
 * database index), opened for one run so the api relays the run's read hints (U2-LIVE).
 */
export function redisReadHintPublisher({
  url,
  environment,
}: {
  url: string | undefined;
  environment: ImageUpgradeInputs["environment"];
}): OpenReadHintPublisher {
  return () => {
    const connection = new RedisConnectionService().connect({
      url,
      clusterEndpoints: environment.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: environment.REDIS_DB_INDEX,
      skip: environment.SKIP_REDIS === "true",
    });
    if (!connection) return null;
    return {
      publish: (channel, message) => connection.publish(channel, message),
      close: () => RedisShutdownService.create().shutdown(connection),
    };
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

/** Said by a serving worker that takes jobs while its run's reconcilers finish. */
const BLOCKING_DONE: UpgradeRunResult = {
  code: "done",
  logTail: ["the blocking part is done; the reconcilers finish beside the worker"],
};

type InProcessUpgradeInput = {
  boot: BootUpgradeModules;
  databaseUrl: string;
  environment: ImageUpgradeInputs["environment"];
  development: boolean;
  /** True for a serving worker; `pnpm task upgrade` waits for the whole run and its exit code. */
  admitAtBlockingDone: boolean;
  openPublisher?: OpenReadHintPublisher;
  signal?: AbortSignal;
  /** The image's upgrade; a test hands its own to read what the run was given. */
  run?: typeof runImageUpgrade;
};

/**
 * One upgrade run in this process over the booted modules; a boot or connection failure answers
 * `failed`. With `admitAtBlockingDone` it answers `done` once the schema and blocking steps are
 * (T0-F11), and the reconcilers finish beside the serving worker, logged and recorded on the run.
 */
export function inProcessUpgrade(input: InProcessUpgradeInput): FirstInstallUpgrade {
  return async (): Promise<UpgradeRunResult> => {
    let onBlockingDone = () => {};
    const blockingDone = new Promise<UpgradeRunResult>((resolve) => {
      onBlockingDone = () => resolve(BLOCKING_DONE);
    });
    const whole = runWhole({ ...input, onBlockingDone: () => onBlockingDone() });
    if (!input.admitAtBlockingDone) return whole;
    const first = await Promise.race([whole, blockingDone]);
    if (first === BLOCKING_DONE) void whole.then(sayReconcileOutcome);
    return first;
  };
}

/** A run that finished after its worker took jobs: a failed reconciler is said, never swallowed. */
function sayReconcileOutcome(result: UpgradeRunResult): void {
  if (result.code === "done") return;
  upgradeRunnerLog().warn(`the upgrade's reconcilers ended ${result.code}: ${result.logTail[0]}`, {
    phase: "reconcile",
    next: "the run is recorded on Ops > Upgrades; fix what it names, then Retry",
  });
}

/** The whole run over the booted modules; never throws, a failure answers `failed`. */
async function runWhole({
  boot,
  databaseUrl,
  environment,
  development,
  openPublisher = () => null,
  signal = new AbortController().signal,
  run = runImageUpgrade,
  admitAtBlockingDone,
  onBlockingDone,
}: InProcessUpgradeInput & { onBlockingDone: () => void }): Promise<UpgradeRunResult> {
  const pool = new pg.Pool(runnerPoolConfig({ databaseUrl }));
  const publisher = openPublisher();
  try {
    const outcome = await boot((modules) =>
      run({
        inputs: {
          postgres: pool,
          databaseUrl,
          environment,
          development,
          steps: modules.migrationSteps(isDeclaredMigrationStep),
          upcasts: upcastStepsOf({ app: modules }),
          // A run-once upgrade has no worker beside it to take the pass request; the next
          // serving worker's own run sends it, and the hourly re-drive backs that up.
          reconcilers: [
            langWatchQlReconciler({ environment }),
            ...(admitAtBlockingDone ? [passRequestReconciler({ modules })] : []),
          ],
          onBlockingDone,
          ...(publisher ? { publish: publisher.publish } : {}),
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
    await publisher?.close();
  }
}
