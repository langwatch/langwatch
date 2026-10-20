import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import chalk from "chalk";
import { Command } from "commander";
import prompts from "prompts";

import { printBanner } from "./animation/banner.ts";
import { heldOutput, streamEventsToTTY } from "./animation/log-tee.ts";
import { openBrowser, runningLine } from "./animation/open-browser.ts";
import { resolveLocalOrchestratorConfig } from "./platform/config/local-orchestrator.config.ts";
import { detectConflicts, type ConflictReport } from "./port-conflict/detect.ts";
import { resolvePortConflicts } from "./port-conflict/resolve.ts";
import { inspectPredeps, printDoctorTable } from "./predeps/detect-only.ts";
import {
  predepGate,
  runPredeps,
  type ArrivedPredep,
  type PredepGate,
  type PredepResult,
} from "./predeps/runner.ts";
import { appRoot } from "./services/app-dir.ts";
import { openBootDoor, type BootDoor } from "./services/boot-door.ts";
import {
  chooseDatabases,
  saveDatabaseChoice,
  shouldAskDatabases,
} from "./services/database-choice.ts";
import { probeDatabase } from "./services/database-probe.ts";
import { readEnvFile } from "./services/env-file.ts";
import { runtime as serviceRuntime } from "./services/runtime.ts";
import { printUpgradeStatus, upgradeStatusDatabaseUrl } from "./services/upgrade-status.ts";
import { ownDatabases, portsInUse, type DatabaseId } from "./shared/databases.ts";
import { captureUserEnv } from "./shared/env.ts";
import { resolveLogSettings } from "./shared/log-level.ts";
import { paths } from "./shared/paths.ts";
import { assertSupportedHost } from "./shared/platform.ts";
import { allocatePorts, installedPortBase, PORT_BASE_DEFAULT } from "./shared/ports.ts";
import {
  exitCause,
  type RuntimeApi,
  type RuntimeContext,
  type RuntimeEvent,
  type ServiceHandle,
} from "./shared/runtime-contract.ts";
import { createShutdown, type ShutdownOutcome } from "./shared/shutdown.ts";
import { CLI_VERSION as VERSION } from "./shared/version.ts";

/**
 * Routed through `RuntimeApi.scaffoldEnv` rather than calling `shared/env.ts`
 * directly, so the CLI stays behind the same contract `services/runtime.ts`
 * implements.
 */
async function ensureEnvFile(
  runtime: RuntimeApi,
  ctx: RuntimeContext,
  opts: { shouldReconcilePorts?: boolean } = {},
): Promise<{ written: boolean; path: string; reconciledKeys: string[] }> {
  return runtime.scaffoldEnv(ctx, opts);
}

function printDryRunAndExit(portBase: string): never {
  const base = Number.parseInt(portBase, 10);
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

const program = new Command();

program
  .name("langwatch-server")
  .description(
    "Run LangWatch locally — postgres, redis, clickhouse, langwatch app, langevals, ai-gateway",
  )
  .version(VERSION, "-v, --version");

program
  .command("start", { isDefault: true })
  .description("install missing predeps, scaffold .env, start every service, open the browser")
  .option("--port-base <n>", "first port slot to use", String(PORT_BASE_DEFAULT))
  .option("-y, --yes", "skip every confirmation prompt", false)
  .option("--no-open", "do not auto-open the browser when ready")
  .option("--databases", "ask again whether to run bundled databases or your own", false)
  .option("--verbose", "log at info and show every service's output in the terminal", false)
  .option(
    "--dry-run",
    "print what would be done and exit (no installs, no env, no services)",
    false,
  )
  .action(async (opts) => {
    assertSupportedHost();
    printBanner(VERSION);
    const orchestrator = resolveLocalOrchestratorConfig(process.env);

    if (opts.dryRun) printDryRunAndExit(opts.portBase);

    const base = Number.parseInt(opts.portBase, 10);
    const { base: resolvedBase } = await resolvePortConflicts({
      base,
      yes: opts.yes,
    });
    const ports = allocatePorts(resolvedBase);

    const runtime: RuntimeApi = serviceRuntime;
    const predeps: PredepResult = {};
    const gate = predepGate({ predeps });
    const logs = resolveLogSettings({ env: process.env, isVerbose: opts.verbose === true });
    const ctx: RuntimeContext = {
      ports,
      paths,
      predeps,
      envFile: paths.envFile,
      version: VERSION,
      userEnv: captureUserEnv(),
      orchestrator,
      predepsReady: gate.ready,
      predepsPresent: gate.present,
      logLevel: logs.level,
    };

    const { isFirstRun } = await reconcileEnvFile({ runtime, ctx });
    const ownStores = await settleDatabases({
      ctx,
      isFirstRun,
      isRequested: opts.databases === true,
      isUnattended: opts.yes || orchestrator.browser.continuousIntegration,
    });
    printFirstRunSignpost();

    // The public port answers at once: a boot page until the backend is healthy, then the app.
    const door = await openBootDoor({
      port: ports.langwatch,
      backendPort: ports.backend,
      report: (line) => console.error(chalk.yellow(line)),
    });
    const url = `http://localhost:${ports.langwatch}`;
    if (shouldOpenBrowser({ isOpenRequested: opts.open !== false, ctx })) {
      await openBrowser(url, ctx.orchestrator.browser);
    }

    // Services start as their predeps arrive (RuntimeContext.predepsReady), not after all of them.
    // An abort ends through `shutdown`, so the stores already started are stopped too.
    const predepsDone = runPredeps({
      config: orchestrator,
      yes: opts.yes,
      version: VERSION,
      skip: ownStores,
      onReady: (ready) => predepArrived({ ready, gate, door }),
      onSkipped: gate.skip,
    })
      .then((run) => {
        if (run.outcome === "aborted") {
          void shutdown({ exitCode: run.exitCode, reason: run.reason });
        }
      })
      .finally(() => gate.finish());
    const write = heldOutput({ until: predepsDone });

    let handles: ServiceHandle[] = [];
    const eventsStream = streamEventsToTTY(runtime.events(ctx), {
      write,
      showsServiceOutput: logs.showsServiceOutput,
      intercept: watchForReady({
        door,
        onReady: () => write(runningLine({ url, logsDir: paths.logs })),
        onEventAfterReady: (ev) => endOnCrash({ ev, shutdown }),
      }),
    });

    // Registered BEFORE startAll so Ctrl+C during install or boot still tears down anything
    // spawned so far: stopAll also reaches the services still waiting on their first health check.
    const shutdown = createShutdown({
      announce: (outcome) => {
        if (outcome.exitCode !== 0) {
          door.fail({ reason: outcome.reason ?? "LangWatch failed", logsDir: paths.logs });
        }
        announceShutdown(outcome);
      },
      stopServices: async () => {
        await runtime.stopAll(handles);
        await door.close();
      },
      // The event stream never ends on its own; give the last "stopped" lines a moment to render.
      flush: () => Promise.race([eventsStream, sleep(500)]).then(() => undefined),
      exit: (code) => process.exit(code),
    });
    process.on("SIGINT", () => void shutdown({ exitCode: 0 }));
    process.on("SIGTERM", () => void shutdown({ exitCode: 0 }));

    try {
      handles = await runtime.startAll(ctx);
    } catch (err) {
      await shutdown({ exitCode: 1, reason: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Block forever, drained by the events tee above. A signal or a crash
    // ends the run through `shutdown`.
    await eventsStream;
  });

/** Scaffolds or reconciles the .env for this run's ports, saying which keys moved. */
async function reconcileEnvFile({
  runtime,
  ctx,
}: {
  runtime: RuntimeApi;
  ctx: RuntimeContext;
}): Promise<{ isFirstRun: boolean }> {
  const envResult = await ensureEnvFile(runtime, ctx, { shouldReconcilePorts: true });
  if (envResult.reconciledKeys.length > 0) {
    console.log(
      chalk.yellow(
        `→ ports moved to ${ctx.ports.base} — updated ${envResult.reconciledKeys.join(", ")} in ${envResult.path}`,
      ),
    );
  }
  return { isFirstRun: envResult.written };
}

/**
 * Asks how to run the databases on the first run and on `--databases`, saves the answer in the
 * .env, and returns the ones this install brings itself (spec 10-database-choice).
 */
async function settleDatabases({
  ctx,
  isFirstRun,
  isRequested,
  isUnattended,
}: {
  ctx: RuntimeContext;
  isFirstRun: boolean;
  isRequested: boolean;
  isUnattended: boolean;
}): Promise<DatabaseId[]> {
  if (shouldAskDatabases({ isFirstRun, isRequested })) {
    const isTerminal = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
    const choice = await chooseDatabases({
      isInteractive: isTerminal && !isUnattended,
      ask: (question) => prompts(question, { onCancel: () => process.exit(130) }),
      probe: probeDatabase,
    });
    saveDatabaseChoice({ envFile: ctx.envFile, ports: ctx.ports, choice });
  }
  return ownDatabases({ env: readEnvFile(ctx.envFile), ports: ctx.ports });
}

/**
 * First-run signpost: cold start can take a few minutes (the downloads, the uv environment);
 * warm starts are under 30s. Shown only when neither paths.bin nor install-manifest.json exist.
 */
function printFirstRunSignpost(): void {
  if (existsSync(paths.bin) || existsSync(paths.installManifest)) return;
  console.log("");
  console.log(
    chalk.dim("Setting up ~/.langwatch for the first time, this may take a few minutes."),
  );
  console.log(chalk.dim("Next runs will be much faster."));
  console.log("");
}

function shouldOpenBrowser({
  isOpenRequested,
  ctx,
}: {
  isOpenRequested: boolean;
  ctx: RuntimeContext;
}): boolean {
  const { openEnabled, continuousIntegration } = ctx.orchestrator.browser;
  return isOpenRequested && openEnabled && !continuousIntegration;
}

/**
 * Feeds every event to the boot page. Ready is the backend healthy, whatever LangEvals is
 * doing: the door forwards to it once, and every later event goes to `onEventAfterReady`.
 */
function watchForReady({
  door,
  onReady,
  onEventAfterReady,
}: {
  door: BootDoor;
  onReady: () => void;
  onEventAfterReady: (ev: RuntimeEvent) => void;
}): (ev: RuntimeEvent) => boolean {
  let isBackendUp = false;
  return (ev) => {
    door.feed(ev);
    if (isBackendUp) onEventAfterReady(ev);
    else if (ev.type === "healthy" && ev.service === "langwatch") {
      isBackendUp = true;
      door
        .openApp()
        .then(onReady)
        .catch((error: unknown) =>
          console.error(chalk.red(`✗ could not open the app: ${String(error)}`)),
        );
    }
    return false;
  };
}

/** Lets the services waiting on a predep go; the app's arrival hands its assets to the door. */
function predepArrived({
  ready,
  gate,
  door,
}: {
  ready: ArrivedPredep;
  gate: PredepGate;
  door: BootDoor;
}): void {
  gate.add(ready);
  if (ready.id !== "app") return;
  door.offerAssets({ clientDir: join(appRoot(), "apps", "ui", "dist", "client") });
}

/** A requested stop reads as one; a failure names its reason. */
function announceShutdown({ exitCode, reason }: ShutdownOutcome): void {
  if (exitCode === 0) {
    console.log(chalk.yellow("\n  ⏻ shutting down LangWatch..."));
    return;
  }
  console.error(chalk.red(`\n✗ ${reason ?? "LangWatch failed"}, shutting down LangWatch...`));
}

/** A service the supervisor gave up on ends the whole run, non-zero. */
function endOnCrash({
  ev,
  shutdown,
}: {
  ev: RuntimeEvent;
  shutdown: (outcome: ShutdownOutcome) => Promise<void>;
}): void {
  if (ev.type !== "crashed") return;
  void shutdown({ exitCode: 1, reason: `${ev.service} crashed (${exitCause(ev)})` });
}

/** Prints doctor's port table, leaving out a brought database's ports; returns the held ones. */
async function portConflicts({
  base,
  listed,
}: {
  base: number;
  listed: { name: string; port: number }[];
}): Promise<ConflictReport["conflicts"]> {
  const report = await detectConflicts(base);
  const held = report.conflicts.filter((c) => listed.some(({ port }) => port === c.port));
  console.log(chalk.bold(`Ports (port-base=${base})`));
  for (const { name, port } of listed) {
    const conflict = held.find((c) => c.port === port);
    const marker = conflict ? chalk.red("✗") : chalk.green("✓");
    console.log(`  ${marker} ${name.padEnd(18)} ${port}`);
    if (conflict) {
      console.log(chalk.dim(`      held by pid ${conflict.pid}: ${conflict.command}`));
    }
  }
  return held;
}

program
  .command("doctor")
  .description("check which predeps and services are installed; do not change anything")
  .option("--port-base <n>", "report the resolved ports for this base (default: the install's)")
  .action(async (opts) => {
    assertSupportedHost();
    printBanner(VERSION);
    const orchestrator = resolveLocalOrchestratorConfig(process.env);
    const env = readEnvFile(paths.envFile);
    const base =
      opts.portBase === undefined ? installedPortBase({ env }) : Number.parseInt(opts.portBase, 10);
    const ports = allocatePorts(base);
    const own = ownDatabases({ env, ports });
    const rows = await inspectPredeps({
      version: VERSION,
      development: orchestrator.development,
      skip: own,
    });
    printDoctorTable(rows);
    const conflicts = await portConflicts({ base, listed: portsInUse({ ports, own }) });
    console.log("");
    await printUpgradeStatus({ databaseUrl: upgradeStatusDatabaseUrl({ env, ports }) });
    console.log("");
    const missing = rows.filter((r) => !r.installed).length;
    const exitCode = missing === 0 && conflicts.length === 0 ? 0 : 1;
    process.exit(exitCode);
  });

program
  .command("install")
  .description("install missing predeps and services without starting anything")
  .option("-y, --yes", "skip confirmation", false)
  .option("--verbose", "show every install step's output in the terminal", false)
  .action(async (opts) => {
    assertSupportedHost();
    printBanner(VERSION);
    const orchestrator = resolveLocalOrchestratorConfig(process.env);
    const env = readEnvFile(paths.envFile);
    // The ports the .env was last written for, so its bundled databases read as bundled.
    const ports = allocatePorts(installedPortBase({ env }));
    const run = await runPredeps({
      config: orchestrator,
      yes: opts.yes,
      version: VERSION,
      // A database the .env already points elsewhere is not downloaded.
      skip: ownDatabases({ env, ports }),
    });
    // Nothing has started yet, so an abort can end here.
    if (run.outcome === "aborted") process.exit(run.exitCode);
    const { predeps } = run;
    const runtime: RuntimeApi = serviceRuntime;
    const logs = resolveLogSettings({ env: process.env, isVerbose: opts.verbose === true });
    const ctx: RuntimeContext = {
      ports,
      paths,
      predeps,
      envFile: paths.envFile,
      version: VERSION,
      userEnv: captureUserEnv(),
      orchestrator,
      logLevel: logs.level,
    };
    // No conflict resolution has run for this port table (unlike "start",
    // which calls resolvePortConflicts first): base is the .env's own.
    // Reconciling now could rewrite a real install's .env to a guess;
    // leave existing port-bound URLs alone.
    await ensureEnvFile(runtime, ctx, { shouldReconcilePorts: false });
    const shown = streamEventsToTTY(runtime.events(ctx), {
      showsServiceOutput: logs.showsServiceOutput,
    });
    await runtime.installServices(ctx);
    // The step lines are buffered on the bus; let the last ones render before the summary.
    await Promise.race([shown, sleep(100)]);
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
      { onCancel: () => process.exit(130) },
    );
    if (!confirmed) {
      console.log(chalk.yellow("Aborted."));
      process.exit(0);
    }
    rmSync(paths.root, { recursive: true, force: true });
    console.log(chalk.green(`✓ removed ${paths.root}`));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`✗ ${err.message ?? err}`));
  process.exit(1);
});
