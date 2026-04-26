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

  for (const [id, det] of Object.entries(detection)) {
    if (det.installed) {
      console.log(chalk.green("✓") + ` ${idLabel(predeps, id)} ${chalk.dim("already installed — " + det.version)}`);
    }
  }

  if (missing.length === 0) {
    return collectResult(predeps, detection, {});
  }

  if (!skipConfirm && !yes) {
    await confirmInstallPrompt(missing);
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

function idLabel(predeps: Predep[], id: string): string {
  return predeps.find((p) => p.id === id)?.label ?? id;
}

async function confirmInstallPrompt(missing: Predep[]): Promise<void> {
  const choices = missing.map((p) => ({
    title: `${p.label}  ${chalk.dim("[required]")}`,
    value: p.id,
    selected: true,
    disabled: false,
  }));
  console.log("");
  console.log(chalk.bold("LangWatch needs the following dependencies. All are required."));
  console.log(chalk.dim("They install once into ~/.langwatch/bin and never touch your shell rc files."));
  console.log("");
  const { confirmed } = await prompts(
    {
      type: "multiselect",
      name: "confirmed",
      message: "Press space to (un)check, return to confirm. Required items cannot be unchecked.",
      choices,
      hint: "- enter to install",
      instructions: false,
      min: missing.length,
    },
    { onCancel: () => process.exit(130) }
  );
  if (!Array.isArray(confirmed) || confirmed.length !== missing.length) {
    console.error(chalk.red("All predeps are required — aborting."));
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
  const tasks = new Listr(
    predeps.map((p) => ({
      title: p.label,
      task: async (_, task) => {
        const result = await p.install({ platform, paths, task });
        installResults[p.id] = result;
        task.title = `${p.label}  ${chalk.dim(result.version)}`;
      },
      retry: { tries: 1, delay: 0 },
      rollback: async () => {
        // future: clean partial download
      },
    })),
    {
      concurrent: true,
      exitOnError: false,
      collectErrors: "minimal",
      rendererOptions: { collapseSubtasks: false, showSubtasks: true },
    }
  );
  await tasks.run();
  if (tasks.errors.length > 0) {
    console.error(chalk.red(`✗ ${tasks.errors.length} predep installation(s) failed`));
    for (const err of tasks.errors) {
      console.error(chalk.red(`  - ${err.message}`));
    }
    process.exit(1);
  }
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
