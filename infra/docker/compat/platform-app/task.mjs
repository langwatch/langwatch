// DEPRECATED: forwards `pnpm run task <old name>` from /app/platform/app to apps/tasks.
// Kept for two releases after the one that introduces it, then deleted with this folder.
// An old name is mapped to its new task; a name with no equivalent exits 2 with the reason.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The image copies this folder to /app/platform/app, so the tasks app is at /app/apps/tasks.
const tasksDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/tasks");

/** The old task is now an upgrade step: `upgrade` runs it, and the worker already does at boot. */
const upgradeStep = (step) => ({ run: ["upgrade"], note: `now the upgrade step ${step}` });

/** Every task name in the previous release's platform/app/src/tasks, and what became of it. */
const OLD_TASKS = {
  "system-migrations": { run: ["system-migrations-pass"] },
  provisionLwql: { run: ["lwql-provision"] },
  renderLwqlAccessConfig: {
    run: ["lwql-render-access-config"],
    // The old task read `--out <dir>`; the new one reads LWQL_RENDER_OUT_DIR.
    outFlagToEnv: "LWQL_RENDER_OUT_DIR",
  },
  migrateObjectStorage: { run: ["object-storage-migrate"], passArgs: true },
  clearStalePendingSsoSetup: { run: ["clear-stale-pending-sso-setup"], passArgs: true },
  generateWebhookSignatureVectors: { run: ["webhook-signature-vectors"], passArgs: true },
  migrateCustomModels: { run: ["model-provider-migrate-custom-models"], passArgs: true },
  runTopicClustering: { run: ["topic-clustering-run"], passArgs: true },
  sendSlackAlert: { run: ["slack-alert"], passArgs: true },
  clickhouseMigrate: {
    run: ["upgrade"],
    note: "ClickHouse and Postgres migrations now run in `upgrade`",
  },
  backfillDatasetContentToS3: upgradeStep("dataset:move-content-to-object-storage"),
  backfillAnnotationsToClickhouse: upgradeStep("annotation:record-trace-annotations"),
  backfillStalledSimulationRuns: upgradeStep("scenario:close-stalled-runs"),
  migrateModelProviderKeys: upgradeStep("model-provider:seal-plaintext-custom-keys"),
  migrateSlackConnections: upgradeStep("automation:import-slack-connections"),
  cleanupOldLambdas: { gone: "nothing replaces the old Lambda clean-up" },
  groupQueueMigrationAudit: {
    gone: "it is now the queue framework's drain audit, called by migrations, not a task",
  },
  generateOpenAPISpec: {
    gone: "the nearest equivalent is `pnpm run openapi:generate` in /app/apps/api, with its own output",
  },
};

const [name, ...args] = process.argv.slice(2);
if (!name) {
  console.error(`Pass an old task name. Known: ${Object.keys(OLD_TASKS).join(", ")}`);
  process.exit(2);
}
const target = OLD_TASKS[name];
if (!target) {
  console.error(
    `Unknown task "${name}". Run the new task name from /app/apps/tasks: pnpm --silent task <name>`,
  );
  process.exit(2);
}
if (target.gone) {
  console.error(`The task "${name}" has no equivalent in this release: ${target.gone}.`);
  process.exit(2);
}

const assignments = [];
const forwarded = target.passArgs ? args : [];
if (target.outFlagToEnv) {
  const at = args.indexOf("--out");
  const joined = args.find((arg) => arg.startsWith("--out="));
  const outDir = at >= 0 ? args[at + 1] : joined?.slice("--out=".length);
  if (!outDir || outDir.startsWith("-")) {
    console.error(`"${name}" needs --out <dir>.`);
    process.exit(2);
  }
  assignments.push(`${target.outFlagToEnv}=${outDir}`);
}
console.error(
  `[deprecated] "${name}" is now "${target.run.join(" ")}"${target.note ? ` (${target.note})` : ""}.`,
);
// `env NAME=value` sets the one variable and leaves the rest of the environment as it is.
const result = spawnSync(
  "env",
  [...assignments, "pnpm", "--silent", "task", ...target.run, ...forwarded],
  { cwd: tasksDir, stdio: "inherit" },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
