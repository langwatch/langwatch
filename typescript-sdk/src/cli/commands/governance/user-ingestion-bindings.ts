import chalk from "chalk";

import {
  GovernanceCliError,
  installUserIngestionBinding,
  listUserIngestionBindings,
  rotateUserIngestionBindingToken,
  uninstallUserIngestionBinding,
} from "@/cli/utils/governance/cli-api";
import { isLoggedIn, loadConfig } from "@/cli/utils/governance/config";

import type { UserIngestionBindingRow } from "@/cli/utils/governance/cli-api";

/**
 * `langwatch governance user-ingestion-bindings <verb>`
 *
 * Mirrors the Hono routes at /api/governance/user-ingestion-bindings
 * (Sergey 5275e7e11). User-bound PAT required for install / uninstall
 * / rotate (legacy project tokens 403 with `human_caller_required`).
 *
 * Verbs: list / install / uninstall / rotate.
 */

function requireLogin() {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write(
      "Not logged in. Run `langwatch login --device` first.\n",
    );
    process.exit(1);
  }
  return cfg;
}

function handleError(err: unknown): never {
  const msg = err instanceof GovernanceCliError ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function printBinding(b: UserIngestionBindingRow): void {
  console.log(
    `${chalk.bold(b.id)}\n` +
      `  template_id:           ${b.template_id}\n` +
      `  user_id:               ${b.user_id}\n` +
      `  organization_id:       ${b.organization_id}\n` +
      `  personal_project_id:   ${b.personal_project_id}\n` +
      `  token_prefix:          ${b.binding_access_token_prefix}…\n` +
      `  enabled:               ${b.enabled ? chalk.green("yes") : chalk.gray("no")}\n` +
      `  created_at:            ${b.created_at}\n`,
  );
}

export async function listCommand(options: {
  json?: boolean;
}): Promise<void> {
  const cfg = requireLogin();
  let rows: UserIngestionBindingRow[];
  try {
    rows = await listUserIngestionBindings(cfg);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(chalk.gray("No bindings installed."));
    return;
  }
  for (const b of rows) {
    console.log(
      `${chalk.green("●")} ${chalk.bold(b.id)}  ${chalk.gray(`tpl=${b.template_id}`)}  ${chalk.gray(b.binding_access_token_prefix + "…")}`,
    );
  }
}

export async function installCommand(
  templateId: string,
  options: { json?: boolean },
): Promise<void> {
  const cfg = requireLogin();
  let result: {
    user_ingestion_binding: UserIngestionBindingRow;
    binding_access_token: string;
  };
  try {
    result = await installUserIngestionBinding(cfg, templateId);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(chalk.green("✓ Binding installed"));
  printBinding(result.user_ingestion_binding);
  console.log(chalk.bold("Access token (shown once):"));
  console.log("  " + chalk.cyan(result.binding_access_token));
  console.log(
    chalk.gray(
      "\n  Set this as the Bearer token in your tool's OTLP exporter:\n" +
        "    OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer " +
        result.binding_access_token,
    ),
  );
}

export async function uninstallCommand(
  bindingId: string,
  options: { json?: boolean },
): Promise<void> {
  const cfg = requireLogin();
  try {
    await uninstallUserIngestionBinding(cfg, bindingId);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify({ ok: true }, null, 2));
    return;
  }
  console.log(chalk.green(`✓ Binding ${bindingId} uninstalled`));
}

export async function rotateCommand(
  bindingId: string,
  options: { json?: boolean },
): Promise<void> {
  const cfg = requireLogin();
  let result: {
    user_ingestion_binding: UserIngestionBindingRow;
    binding_access_token: string;
  };
  try {
    result = await rotateUserIngestionBindingToken(cfg, bindingId);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    chalk.yellow(
      "⚠  Hard-cut rotation: previous token is invalidated immediately.",
    ),
  );
  console.log(chalk.green("✓ Token rotated"));
  console.log(chalk.bold("New access token (shown once):"));
  console.log("  " + chalk.cyan(result.binding_access_token));
}
