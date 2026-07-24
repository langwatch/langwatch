import chalk from "chalk";
import { Listr } from "listr2";
import { mkdirSync } from "node:fs";
import prompts from "prompts";
import { paths } from "../shared/paths.ts";
import { detectPlatform, type SupportedPlatform } from "../shared/platform.ts";
import { predepRegistry } from "./registry.ts";
import type { Predep } from "./types.ts";

export type PredepResult = Record<string, { version: string; resolvedPath: string; preInstalled: boolean }>;

export type PredepOptions = {
  yes?: boolean;
  skipConfirm?: boolean;
  version: string;
};

export async function runPredeps({ yes = false, skipConfirm = false, version }: PredepOptions): Promise<PredepResult> {
  const platform = detectPlatform();
  mkdirSync(paths.bin, { recursive: true });
  mkdirSync(paths.data, { recursive: true });
  mkdirSync(paths.logs, { recursive: true });
  mkdirSync(paths.redisData, { recursive: true });
  mkdirSync(paths.postgresData, { recursive: true });
  mkdirSync(paths.clickhouseData, { recursive: true });

  const predeps = predepRegistry({ version });
  const detection = await detectAll(predeps);
  const missing = predeps.filter((p) => !detection[p.id]?.installed);

  if (missing.length === 0) {
    return collectResult(predeps, detection, {});
  }

  // Only `uv` warrants a confirmation prompt — it's the one predep that
  // installs into the user's home (`~/.local/bin/uv` via the official
  // installer) instead of being a self-contained binary under
  // `~/.langwatch/bin`. Every other predep is a static binary we drop into
  // `~/.langwatch/bin` and which `rm -rf ~/.langwatch` cleans up — no need
  // to bother the user about it.
  if (!skipConfirm && !yes && missing.some((p) => p.id === "uv")) {
    await confirmUvInstallPrompt();
  }

  const installResults: Record<string, { version: string; resolvedPath: string }> = {};
  await runListr({ predeps: missing, platform, installResults });

  return collectResult(predeps, detection, installResults);
}

async function detectAll(predeps: Predep[]) {
  const out: Record<string, Awaited<ReturnType<Predep["detect"]>>> = {};
  await Promise.all(
    predeps.map(async (p) => {
      out[p.id] = await p.detect(paths);
    })
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
    { onCancel: () => process.exit(130) }
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
}: {
  predeps: Predep[];
  platform: SupportedPlatform;
  installResults: Record<string, { version: string; resolvedPath: string }>;
}): Promise<void> {
  const remaining = [...predeps];
  // Loop until every predep either installs or the user explicitly skips it.
  // Each pass runs the still-unfinished predeps concurrently in a fresh
  // listr instance so the user sees a clean redraw on retry.
  while (remaining.length > 0) {
    const failed: Array<{ predep: Predep; error: Error }> = [];
    const tasks = new Listr(
      remaining.map((p) => ({
        title: p.label,
        task: async (_, task) => {
          try {
            const result = await p.install({ platform, paths, task });
            installResults[p.id] = result;
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
      }
    );
    await tasks.run().catch(() => {
      // listr re-throws even with exitOnError: false; we already captured
      // the per-predep error in the task wrapper above.
    });

    if (failed.length === 0) return;

    const action = await promptOnFailure(failed);
    if (action === "abort") {
      console.error(chalk.red(`✗ aborting — ${failed.length} predep(s) did not install.`));
      process.exit(1);
    }
    if (action === "skip") {
      console.warn(
        chalk.yellow(
          `⚠ skipping ${failed.length} predep(s) — services that depend on them will fail to start.`
        )
      );
      return;
    }
    // retry: keep only the failed ones in `remaining` and loop.
    remaining.length = 0;
    remaining.push(...failed.map((f) => f.predep));
  }
}

async function promptOnFailure(failed: Array<{ predep: Predep; error: Error }>): Promise<"retry" | "skip" | "abort"> {
  console.error("");
  console.error(chalk.red.bold(`✗ ${failed.length} predep(s) failed:`));
  for (const f of failed) {
    console.error(`  ${chalk.red("✗")} ${f.predep.label}: ${f.error.message}`);
  }
  if (process.env.CI) return "abort";
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
    { onCancel: () => process.exit(130) }
  );
  return action ?? "abort";
}

function collectResult(
  predeps: Predep[],
  detection: Record<string, Awaited<ReturnType<Predep["detect"]>>>,
  installResults: Record<string, { version: string; resolvedPath: string }>
): PredepResult {
  const out: PredepResult = {};
  for (const p of predeps) {
    const det = detection[p.id];
    if (det?.installed) {
      out[p.id] = { version: det.version, resolvedPath: det.resolvedPath, preInstalled: true };
      continue;
    }
    const inst = installResults[p.id];
    if (inst) {
      out[p.id] = { version: inst.version, resolvedPath: inst.resolvedPath, preInstalled: false };
    }
  }
  return out;
}
