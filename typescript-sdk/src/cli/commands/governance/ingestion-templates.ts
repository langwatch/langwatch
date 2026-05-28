import chalk from "chalk";

import {
  adminListIngestionTemplates,
  archiveIngestionTemplate,
  cloneIngestionTemplateFromPlatform,
  createIngestionTemplate,
  getIngestionTemplate,
  GovernanceCliError,
  listIngestionTemplates,
  updateIngestionTemplateOttlRules,
} from "@/cli/utils/governance/cli-api";
import { isLoggedIn, loadConfig } from "@/cli/utils/governance/config";

import type { IngestionTemplateRow } from "@/cli/utils/governance/cli-api";

/**
 * `langwatch governance ingestion-templates <verb>`
 *
 * Mirrors the Hono routes at /api/governance/ingestion-templates
 * (Sergey 0bb951160). Every mutating call carries
 * `X-LangWatch-Surface: cli` so audit rows land with
 * `metadata.surface = 'cli'`.
 *
 * Verbs: list / admin-list / get / create / update-ottl-rules /
 * archive / clone-from-platform.
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

function printTemplate(t: IngestionTemplateRow): void {
  console.log(
    `${chalk.bold(t.display_name)}  ${chalk.gray(`(${t.slug})`)}\n` +
      `  id:                 ${t.id}\n` +
      `  source_type:        ${t.source_type}\n` +
      `  scope:              ${
        t.platform_published ? chalk.cyan("Platform") : chalk.magenta("Org-authored")
      }\n` +
      `  enabled:            ${t.enabled ? chalk.green("yes") : chalk.gray("no")}\n` +
      `  credential_schema:  ${t.credential_schema ?? chalk.gray("(none)")}\n`,
  );
}

function printTemplateList(rows: IngestionTemplateRow[]): void {
  if (rows.length === 0) {
    console.log(chalk.gray("No ingestion templates found."));
    return;
  }
  for (const t of rows) {
    console.log(
      `${t.platform_published ? chalk.cyan("◆") : chalk.magenta("◇")} ${chalk.bold(
        t.display_name,
      )}  ${chalk.gray(t.slug)}  ${chalk.gray(t.source_type)}`,
    );
  }
}

export async function listCommand(options: {
  json?: boolean;
}): Promise<void> {
  const cfg = requireLogin();
  let rows: IngestionTemplateRow[];
  try {
    rows = await listIngestionTemplates(cfg);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  printTemplateList(rows);
}

export async function adminListCommand(options: {
  json?: boolean;
}): Promise<void> {
  const cfg = requireLogin();
  let rows: IngestionTemplateRow[];
  try {
    rows = await adminListIngestionTemplates(cfg);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  printTemplateList(rows);
}

export async function getCommand(
  id: string,
  options: { json?: boolean },
): Promise<void> {
  const cfg = requireLogin();
  let row: IngestionTemplateRow;
  try {
    row = await getIngestionTemplate(cfg, id);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  printTemplate(row);
}

export async function createCommand(options: {
  sourceType: string;
  displayName: string;
  description?: string;
  iconAsset?: string;
  credentialSchema?: string;
  ottlRules?: string;
  json?: boolean;
}): Promise<void> {
  const cfg = requireLogin();
  if (
    options.credentialSchema &&
    !["otlp_token", "static_api_key", "agent_id"].includes(
      options.credentialSchema,
    )
  ) {
    process.stderr.write(
      `Error: --credential-schema must be one of: otlp_token, static_api_key, agent_id\n`,
    );
    process.exit(1);
  }
  let row: IngestionTemplateRow;
  try {
    row = await createIngestionTemplate(cfg, {
      source_type: options.sourceType,
      display_name: options.displayName,
      description: options.description,
      icon_asset: options.iconAsset,
      credential_schema: (options.credentialSchema ?? null) as
        | "otlp_token"
        | "static_api_key"
        | "agent_id"
        | null,
      ottl_rules: options.ottlRules,
    });
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  console.log(chalk.green("✓ Template created"));
  printTemplate(row);
}

export async function updateOttlRulesCommand(
  id: string,
  options: { ottlRules: string; json?: boolean },
): Promise<void> {
  const cfg = requireLogin();
  let row: IngestionTemplateRow;
  try {
    row = await updateIngestionTemplateOttlRules(cfg, id, options.ottlRules);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  console.log(chalk.green("✓ OTTL rules updated"));
}

export async function archiveCommand(
  id: string,
  options: { json?: boolean },
): Promise<void> {
  const cfg = requireLogin();
  try {
    await archiveIngestionTemplate(cfg, id);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify({ ok: true }, null, 2));
    return;
  }
  console.log(chalk.green(`✓ Template ${id} archived`));
}

export async function cloneFromPlatformCommand(
  sourceTemplateId: string,
  options: { json?: boolean },
): Promise<void> {
  const cfg = requireLogin();
  let row: IngestionTemplateRow;
  try {
    row = await cloneIngestionTemplateFromPlatform(cfg, sourceTemplateId);
  } catch (err) {
    handleError(err);
  }
  if (options.json) {
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  console.log(chalk.green("✓ Template cloned"));
  printTemplate(row);
}
