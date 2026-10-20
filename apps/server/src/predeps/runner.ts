import { mkdirSync } from "node:fs";

import chalk from "chalk";
import { Listr } from "listr2";
import prompts from "prompts";

import type { LocalOrchestratorConfig } from "../platform/config/local-orchestrator.config.ts";
import { paths } from "../shared/paths.ts";
import { detectPlatform, type SupportedPlatform } from "../shared/platform.ts";
import { predepRegistry } from "./registry.ts";
import type { Predep, PredepId } from "./types.ts";

type ResolvedPredep = { version: string; resolvedPath: string; preInstalled: boolean };
export type PredepResult = Record<string, ResolvedPredep>;
/** One predep the moment it is there, found or installed. */
export type ArrivedPredep = { id: PredepId; resolved: ResolvedPredep };

export type PredepOptions = {
  config: LocalOrchestratorConfig;
  yes?: boolean;
  skipConfirm?: boolean;
  version: string;
  /** Predeps this install does without: the databases the person brings (10-database-choice). */
  skip?: readonly PredepId[];
  /** Told about each predep the moment it is there, found or installed, before the rest finish. */
  onReady?: (predep: ArrivedPredep) => void;
};

/**
 * Fills `predeps` as `runPredeps` reports each one, and lets a service wait on the ones it
 * needs (RuntimeContext.predepsReady). Once the run finishes, a wait on a missing one fails.
 */
export function predepGate({ predeps }: { predeps: PredepResult }) {
  type Wait = { ids: readonly PredepId[]; resolve: () => void; reject: (error: Error) => void };
  const waits = new Set<Wait>();
  let isFinished = false;
  const settle = () => {
    for (const wait of waits) {
      const missing = wait.ids.filter((id) => !(id in predeps));
      if (missing.length > 0 && !isFinished) continue;
      waits.delete(wait);
      if (missing.length === 0) wait.resolve();
      else wait.reject(new Error(`${missing.join(", ")} did not install`));
    }
  };
  return {
    ready: (ids: readonly PredepId[]) =>
      new Promise<void>((resolve, reject) => {
        waits.add({ ids, resolve, reject });
        settle();
      }),
    add: ({ id, resolved }: ArrivedPredep) => {
      predeps[id] = resolved;
      settle();
    },
    finish: () => {
      isFinished = true;
      settle();
    },
  };
}

export type PredepGate = ReturnType<typeof predepGate>;

export async function runPredeps({
  config,
  yes = false,
  skipConfirm = false,
  version,
  skip = [],
  onReady,
}: PredepOptions): Promise<PredepResult> {
  const platform = detectPlatform();
  mkdirSync(paths.bin, { recursive: true });
  mkdirSync(paths.data, { recursive: true });
  mkdirSync(paths.logs, { recursive: true });
  mkdirSync(paths.redisData, { recursive: true });
  mkdirSync(paths.postgresData, { recursive: true });
  mkdirSync(paths.clickhouseData, { recursive: true });

  const predeps = predepRegistry({ version, development: config.development }).filter(
    (predep) => !skip.includes(predep.id),
  );
  const detection = await detectAll(predeps);
  for (const [id, resolved] of Object.entries(collectResult(predeps, detection, {}))) {
    onReady?.({ id: id as PredepId, resolved });
  }
  const missing = predeps.filter((p) => !detection[p.id]?.installed);

  if (missing.length === 0) {
    return collectResult(predeps, detection, {});
  }

  // Only `uv` warrants a confirmation: it installs into the user's home
  // (`~/.local/bin/uv`) rather than `~/.langwatch/bin`, where every other
  // predep lives and `rm -rf ~/.langwatch` fully cleans up.
  if (!skipConfirm && !yes && missing.some((p) => p.id === "uv")) {
    await confirmUvInstallPrompt();
  }

  const installResults: Record<string, { version: string; resolvedPath: string }> = {};
  await runListr({
    predeps: missing,
    platform,
    installResults,
    continuousIntegration: config.browser.continuousIntegration,
    onInstalled: ({ id, result }) =>
      onReady?.({ id, resolved: { ...result, preInstalled: false } }),
  });

  return collectResult(predeps, detection, installResults);
}

async function detectAll(predeps: Predep[]) {
  const out: Record<string, Awaited<ReturnType<Predep["detect"]>>> = {};
  await Promise.all(
    predeps.map(async (p) => {
      out[p.id] = await p.detect(paths);
    }),
  );
  return out;
}

async function confirmUvInstallPrompt(): Promise<void> {
  const { ok } = await prompts(
    {
      type: "confirm",
      name: "ok",
      message: "LangWatch needs to install `uv` (Astral's Python package manager) — proceed?",
      initial: true,
    },
    { onCancel: () => process.exit(130) },
  );
  if (!ok) {
    console.error(chalk.red("Aborted — `uv` is required to run langevals."));
    process.exit(1);
  }
}

async function runListr({
  predeps,
  platform,
  installResults,
  continuousIntegration,
  onInstalled,
}: {
  predeps: Predep[];
  platform: SupportedPlatform;
  installResults: Record<string, { version: string; resolvedPath: string }>;
  continuousIntegration: boolean;
  onInstalled: (installed: {
    id: PredepId;
    result: { version: string; resolvedPath: string };
  }) => void;
}): Promise<void> {
  const remaining = [...predeps];
  // Loop until every predep either installs or the user explicitly skips it.
  // Each pass runs the still-unfinished predeps concurrently in a fresh
  // listr instance so the user sees a clean redraw on retry.
  while (remaining.length > 0) {
    const failed: { predep: Predep; error: Error }[] = [];
    const tasks = new Listr(
      remaining.map((p) => ({
        title: p.label,
        task: async (_, task) => {
          try {
            const result = await p.install({ platform, paths, task });
            installResults[p.id] = result;
            onInstalled({ id: p.id, result });
            task.title = `${p.label}  ${chalk.dim(result.version)}`;
          } catch (err) {
            failed.push({ predep: p, error: err as Error });
            throw err;
          }
        },
      })),
      {
        concurrent: true,
        exitOnError: false,
        collectErrors: "minimal",
        rendererOptions: { collapseSubtasks: false, showSubtasks: true },
      },
    );
    await tasks.run().catch(() => {
      // listr re-throws even with exitOnError: false; we already captured
      // the per-predep error in the task wrapper above.
    });

    if (failed.length === 0) return;

    const action = await promptOnFailure(failed, continuousIntegration);
    if (action === "abort") {
      console.error(chalk.red(`✗ aborting — ${failed.length} predep(s) did not install.`));
      process.exit(1);
    }
    if (action === "skip") {
      console.warn(
        chalk.yellow(
          `⚠ skipping ${failed.length} predep(s) — services that depend on them will fail to start.`,
        ),
      );
      return;
    }
    // retry: keep only the failed ones in `remaining` and loop.
    remaining.length = 0;
    remaining.push(...failed.map((f) => f.predep));
  }
}

async function promptOnFailure(
  failed: { predep: Predep; error: Error }[],
  continuousIntegration: boolean,
): Promise<"retry" | "skip" | "abort"> {
  console.error("");
  console.error(chalk.red.bold(`✗ ${failed.length} predep(s) failed:`));
  for (const f of failed) {
    console.error(`  ${chalk.red("✗")} ${f.predep.label}: ${f.error.message}`);
  }
  if (continuousIntegration) return "abort";
  const { action } = await prompts(
    {
      type: "select",
      name: "action",
      message: "How would you like to proceed?",
      choices: [
        { title: "Retry the failed installs", value: "retry" },
        { title: "Skip and continue (services using these will fail)", value: "skip" },
        { title: "Abort", value: "abort" },
      ],
      initial: 0,
    },
    { onCancel: () => process.exit(130) },
  );
  return action ?? "abort";
}

function collectResult(
  predeps: Predep[],
  detection: Record<string, Awaited<ReturnType<Predep["detect"]>>>,
  installResults: Record<string, { version: string; resolvedPath: string }>,
): PredepResult {
  const out: PredepResult = {};
  for (const p of predeps) {
    const det = detection[p.id];
    if (det?.installed) {
      out[p.id] = {
        version: det.version,
        resolvedPath: det.resolvedPath,
        preInstalled: true,
      };
      continue;
    }
    const inst = installResults[p.id];
    if (inst) {
      out[p.id] = {
        version: inst.version,
        resolvedPath: inst.resolvedPath,
        preInstalled: false,
      };
    }
  }
  return out;
}
