import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import prompts from "prompts";
import { printBanner, printPhases } from "./animation/banner.ts";
import { openBrowser } from "./animation/open-browser.ts";
import { streamEventsToTTY } from "./animation/log-tee.ts";
import { runPredeps } from "./predeps/runner.ts";
import { inspectPredeps, printDoctorTable } from "./predeps/detect-only.ts";
import { resolvePortConflicts } from "./port-conflict/resolve.ts";
import { paths } from "./shared/paths.ts";
import { allocatePorts, PORT_BASE_DEFAULT } from "./shared/ports.ts";
import { detectPlatform } from "./shared/platform.ts";
import { captureUserEnv, scaffoldEnvFile } from "./shared/env.ts";
import { placeholderRuntime, type RuntimeApi, type RuntimeContext } from "./shared/runtime-placeholder.ts";

declare const __LANGWATCH_VERSION__: string;
const VERSION = typeof __LANGWATCH_VERSION__ !== "undefined" ? __LANGWATCH_VERSION__ : "0.0.0-dev";

async function loadRuntime(): Promise<RuntimeApi> {
  try {
    // services/runtime.ts is julia's lane — see specs/npx-installer/03-services.feature.
    const real = await import("./services/runtime.ts" as any);
    if (real?.runtime) return real.runtime;
    console.warn(chalk.yellow("⚠ services/runtime.ts loaded but does not export `runtime` — falling back to placeholder"));
    return placeholderRuntime;
  } catch (err) {
    console.warn(chalk.yellow(`⚠ failed to load services/runtime.ts: ${(err as Error).message}`));
    return placeholderRuntime;
  }
}

function ensureEnvFile(ctx: RuntimeContext): { written: boolean; path: string } {
  return scaffoldEnvFile({ ports: ctx.ports, path: ctx.paths.envFile });
}

const program = new Command();

program
  .name("langwatch-server")
  .description("Run LangWatch locally — postgres, redis, clickhouse, langwatch app, langwatch_nlp, langevals, ai-gateway")
  .version(VERSION, "-v, --version");

program
  .command("start", { isDefault: true })
  .description("install missing predeps, scaffold .env, start every service, open the browser")
  .option("--port-base <n>", "first port slot to use (app tier base..base+9, infra tier base+1000..+1009)", String(PORT_BASE_DEFAULT))
  .option("-y, --yes", "skip every confirmation prompt", false)
  .option("--no-open", "do not auto-open the browser when ready")
  .option("--bullboard", "expose the BullMQ dashboard on the bullboard infra slot", false)
  .option("--dry-run", "print what would be done and exit (no installs, no env, no services)", false)
  .action(async (opts) => {
    detectPlatform();
    printBanner(VERSION);
    printPhases();

    if (opts.dryRun) {
      const base = Number.parseInt(opts.portBase, 10);
      const ports = allocatePorts(base);
      console.log(chalk.bold("dry-run — no work performed"));
      console.log("");
      console.log(chalk.bold("port-base:"), base);
      console.log(chalk.bold("ports:"));
      for (const [k, v] of Object.entries(ports)) {
        if (k === "base") continue;
        console.log(`  ${k.padEnd(18)} ${v}`);
      }
      console.log("");
      console.log(chalk.bold("paths:"));
      for (const [k, v] of Object.entries(paths)) console.log(`  ${k.padEnd(18)} ${v}`);
      process.exit(0);
    }

    if (!opts.yes) {
      const { go } = await prompts(
        { type: "confirm", name: "go", message: "Ready to install and start LangWatch?", initial: true },
        { onCancel: () => process.exit(130) }
      );
      if (!go) {
        console.log(chalk.yellow("Aborted."));
        process.exit(0);
      }
    }

    const base = Number.parseInt(opts.portBase, 10);
    const { base: resolvedBase } = await resolvePortConflicts({ base, yes: opts.yes });
    const ports = allocatePorts(resolvedBase);

    console.log("");
    console.log(chalk.bold.cyan("[1/4] predeps"));
    const predeps = await runPredeps({ yes: opts.yes, version: VERSION });

    const runtime = await loadRuntime();
    const ctx: RuntimeContext = {
      ports,
      paths,
      predeps,
      envFile: paths.envFile,
      version: VERSION,
      bullboard: Boolean(opts.bullboard),
      userEnv: captureUserEnv(),
    };

    console.log("");
    console.log(chalk.bold.cyan("[2/4] env"));
    const env = ensureEnvFile(ctx);
    console.log(env.written ? chalk.green(`✓ scaffolded ${env.path}`) : chalk.dim(`= ${env.path} already exists`));

    console.log("");
    console.log(chalk.bold.cyan("[3/4] services"));
    await runtime.installServices(ctx);

    console.log("");
    console.log(chalk.bold.cyan("[4/4] start"));
    const eventsStream = streamEventsToTTY(runtime.events(ctx));
    const handles = await runtime.startAll(ctx);
    await runtime.waitForHealth(ctx, { timeoutMs: 60_000 });

    const url = `http://localhost:${ports.langwatch}`;
    if (opts.open !== false && !process.env.CI) await openBrowser(url);

    const onShutdown = async () => {
      console.log(chalk.yellow("\n  ⏻ shutting down LangWatch..."));
      await runtime.stopAll(handles);
      await eventsStream;
      process.exit(0);
    };
    process.on("SIGINT", onShutdown);
    process.on("SIGTERM", onShutdown);

    // Block forever — drained by the events tee above. SIGINT exits via
    // `onShutdown`; an uncaught crash event in renderEvent ends the
    // iterator and returns control here.
    await eventsStream;
  });

program
  .command("doctor")
  .description("check which predeps and services are installed; do not change anything")
  .option("--port-base <n>", "report the resolved ports for this base", String(PORT_BASE_DEFAULT))
  .action(async (opts) => {
    detectPlatform();
    printBanner(VERSION);
    const rows = await inspectPredeps({ version: VERSION });
    printDoctorTable(rows);
    const base = Number.parseInt(opts.portBase, 10);
    const ports = allocatePorts(base);
    const { detectConflicts } = await import("./port-conflict/detect.ts");
    const conflicts = await detectConflicts(base);
    console.log(chalk.bold(`Ports (port-base=${base})`));
    for (const [k, v] of Object.entries(ports)) {
      if (k === "base") continue;
      const conflict = conflicts.conflicts.find((c) => c.port === v);
      const marker = conflict ? chalk.red("✗") : chalk.green("✓");
      console.log(`  ${marker} ${k.padEnd(18)} ${v}`);
      if (conflict) {
        console.log(chalk.dim(`      held by pid ${conflict.pid}: ${conflict.command}`));
      }
    }
    console.log("");
    const missing = rows.filter((r) => !r.installed).length;
    const exitCode = missing === 0 && conflicts.conflicts.length === 0 ? 0 : 1;
    process.exit(exitCode);
  });

program
  .command("install")
  .description("install missing predeps and services without starting anything")
  .option("-y, --yes", "skip confirmation", false)
  .action(async (opts) => {
    detectPlatform();
    printBanner(VERSION);
    await runPredeps({ yes: opts.yes, version: VERSION });
    const runtime = await loadRuntime();
    const base = PORT_BASE_DEFAULT;
    const ports = allocatePorts(base);
    const ctx: RuntimeContext = {
      ports,
      paths,
      predeps: {},
      envFile: paths.envFile,
      version: VERSION,
      bullboard: false,
      userEnv: captureUserEnv(),
    };
    ensureEnvFile(ctx);
    await runtime.installServices(ctx);
    console.log(chalk.green("✓ install complete — run `npx @langwatch/server` to start"));
  });

program
  .command("reset")
  .description("delete ~/.langwatch (binaries, data, env) so the next run is a clean install")
  .action(async () => {
    const { confirmed } = await prompts(
      {
        type: "confirm",
        name: "confirmed",
        message: `Permanently delete ${paths.root} (binaries, postgres data, redis data, clickhouse data, env)?`,
        initial: false,
      },
      { onCancel: () => process.exit(130) }
    );
    if (!confirmed) {
      console.log(chalk.yellow("Aborted."));
      process.exit(0);
    }
    const { rmSync } = await import("node:fs");
    rmSync(paths.root, { recursive: true, force: true });
    console.log(chalk.green(`✓ removed ${paths.root}`));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`✗ ${err.message ?? err}`));
  process.exit(1);
});

// Pull resolve to silence "unused import" if commander is configured oddly.
void resolve;
