/**
 * `--project`, declared once over the finished command tree so no family can forget it. Exceptions
 * are listed with reasons; the `preAction` hook publishes the value to the credential holder.
 * @see src/cli/__tests__/project-option.unit.test.ts
 * @see specs/typescript-sdk/cli-cross-project-access.feature
 */

import type { Command } from "commander";

/**
 * Help for `--project`, shared by every command that reads across projects.
 * The default is the personal project, which is where these commands pointed
 * before the flag existed, so an existing script keeps its meaning.
 */
export const PROJECT_FLAG_HELP =
  "Project to run against, by id or slug (default: your personal project). Needs a login that reaches it; `langwatch projects list` shows which ones do";

/**
 * Commands that do not run inside a project, each with its reason: machine-local,
 * organization-scoped (the management plane), or naming projects rather than running in one.
 */
export const COMMANDS_WITHOUT_PROJECT: Record<string, string> = {
  // This machine only: no request leaves, so there is no project to name.
  claude: "runs a coding tool on this machine",
  code: "runs a coding tool on this machine",
  codex: "runs a coding tool on this machine",
  copilot: "runs a coding tool on this machine",
  cursor: "runs a coding tool on this machine",
  gemini: "runs a coding tool on this machine",
  opencode: "runs a coding tool on this machine",
  commands: "lists this CLI's own commands",
  docs: "prints documentation bundled with this CLI",
  "scenario-docs": "prints documentation bundled with this CLI",
  help: "prints help",
  "help-tree": "prints help",
  open: "opens a URL in the browser",
  report: "reads this machine's own session files",
  logout: "drops the login stored on this machine",
  "config get": "reads this machine's CLI config file",
  "config list": "reads this machine's CLI config file",
  "config set": "writes this machine's CLI config file",
  "daemon start": "controls the CLI daemon on this machine",
  "daemon status": "controls the CLI daemon on this machine",
  "daemon stop": "controls the CLI daemon on this machine",
  "skills get": "installs skill files on this machine",
  "skills install": "installs skill files on this machine",
  "skills list": "installs skill files on this machine",
  "skills uninstall": "installs skill files on this machine",
  "skills update": "installs skill files on this machine",
  "copilot-app connect": "wires a coding tool on this machine",
  langy: "relays a local agent session",
  "ingest codex": "wires telemetry on this machine",
  "ingest context": "wires telemetry on this machine",
  "ingest guidance": "wires telemetry on this machine",
  "ingest health": "wires telemetry on this machine",
  "ingest hook": "wires telemetry on this machine",
  "ingest install": "wires telemetry on this machine",
  "ingest list": "wires telemetry on this machine",
  "ingest tail": "wires telemetry on this machine",
  "evaluator types": "lists the evaluator catalog built into this CLI",

  // The person, and the organization they belong to.
  whoami: "answers for the logged-in person",
  "governance status": "answers for the organization",
  "governance ingestion-templates admin-list": "answers for the organization",
  "governance ingestion-templates archive": "answers for the organization",
  "governance ingestion-templates clone-from-platform": "answers for the organization",
  "governance ingestion-templates create": "answers for the organization",
  "governance ingestion-templates get": "answers for the organization",
  "governance ingestion-templates update-ottl-rules": "answers for the organization",
  "organization get": "answers for the organization",
  "organization update": "answers for the organization",
  "organizations create": "answers for the organization",
  "organizations get": "answers for the organization",
  "organizations list": "answers for the organization",
  "members access": "answers for the organization",
  "members disable": "answers for the organization",
  "members enable": "answers for the organization",
  "members get": "answers for the organization",
  "members list": "answers for the organization",
  "members remove": "answers for the organization",
  "members update": "answers for the organization",
  "invites create": "answers for the organization",
  "invites list": "answers for the organization",
  "invites revoke": "answers for the organization",
  "teams archive": "answers for the organization",
  "teams create": "answers for the organization",
  "teams get": "answers for the organization",
  "teams list": "answers for the organization",
  "teams update": "answers for the organization",
  "teams members add": "answers for the organization",
  "teams members list": "answers for the organization",
  "teams members remove": "answers for the organization",
  "groups create": "answers for the organization",
  "groups delete": "answers for the organization",
  "groups get": "answers for the organization",
  "groups list": "answers for the organization",
  "groups rename": "answers for the organization",
  "groups members add": "answers for the organization",
  "groups members list": "answers for the organization",
  "groups members remove": "answers for the organization",
  "groups bindings add": "answers for the organization",
  "groups bindings list": "answers for the organization",
  "groups bindings remove": "answers for the organization",
  "roles create": "answers for the organization",
  "roles delete": "answers for the organization",
  "roles get": "answers for the organization",
  "roles list": "answers for the organization",
  "roles permissions": "answers for the organization",
  "roles update": "answers for the organization",
  "role-bindings create": "answers for the organization",
  "role-bindings delete": "answers for the organization",
  "role-bindings list": "answers for the organization",
  "role-bindings update": "answers for the organization",
  "scim-tokens create": "answers for the organization",
  "scim-tokens list": "answers for the organization",
  "scim-tokens revoke": "answers for the organization",
  "api-keys create": "answers for the organization",
  "api-keys get": "answers for the organization",
  "api-keys list": "answers for the organization",
  "api-keys revoke": "answers for the organization",
  "api-keys update": "answers for the organization",
  "webhooks archive": "answers for the organization",
  "webhooks create": "answers for the organization",
  "webhooks deliveries": "answers for the organization",
  "webhooks disable": "answers for the organization",
  "webhooks enable": "answers for the organization",
  "webhooks event-types": "answers for the organization",
  "webhooks events": "answers for the organization",
  "webhooks get": "answers for the organization",
  "webhooks health": "answers for the organization",
  "webhooks list": "answers for the organization",
  "webhooks roll-secret": "answers for the organization",
  "webhooks test": "answers for the organization",
  "webhooks update": "answers for the organization",
  "spend-events by-user": "answers for the organization",
  "spend-events replay": "answers for the organization",
  // The budget, not the traffic: `list` reads every scope the organization
  // has, and the other three act on a budget id. Pointing the credential at a
  // project would change which role binding the server reads without changing
  // the budget that answers.
  "gateway-budgets archive": "answers for the organization",
  "gateway-budgets list": "answers for the organization",
  "gateway-budgets reset": "answers for the organization",
  "gateway-budgets update": "answers for the organization",

  // Names projects rather than running inside one.
  "projects create": "names projects rather than running inside one",
  "projects delete": "names projects rather than running inside one",
  "projects get": "names projects rather than running inside one",
  "projects list": "names projects rather than running inside one",
  "projects update": "names projects rather than running inside one",
};

/**
 * Commands that already declare a `--project` of their own MEANING SOMETHING ELSE. Left exactly as
 * they are: the value is the command's own argument, so reading it as the credential's target would
 * point the command at a project the user did not ask it to run as.
 */
export const COMMANDS_WITH_OWN_PROJECT_FLAG: Record<string, string> = {
  login: "the project whose key is written to .env",
  instrument: "the project the telemetry wiring points at",
  "gateway-budgets create": "the project the budget is scoped to",
  "spend-events list": "a filter inside an organization-wide listing",
  "spend-events summary": "a filter inside an organization-wide listing",
};

/**
 * Marks a command whose `--project` names the project its request runs
 * against. A Symbol keyed on the command object, so it travels with the tree
 * the daemon rebuilds per request and never becomes shared state.
 */
const PROJECT_SCOPED = Symbol("langwatch.cli.projectScoped");

/** The command's full path, as a user types it, without the program name. */
export const commandPath = (cmd: Command): string => {
  const parts: string[] = [];
  for (let node: Command | null = cmd; node?.parent; node = node.parent as Command | null) {
    parts.push(node.name());
  }
  return parts.reverse().join(" ");
};

/** Every leaf of the tree: the commands that actually run something. */
export const leafCommands = (root: Command): Command[] => {
  const subs = root.commands as Command[];
  if (subs.length === 0) return root.parent ? [root] : [];
  return subs.flatMap(leafCommands);
};

/**
 * Declare `--project` on every in-project leaf and mark it as a credential target; called once at
 * the end of `buildProgram`. Leaves that already declare it keep their own and are only marked.
 */
export const applyProjectOption = (program: Command): void => {
  for (const leaf of leafCommands(program)) {
    const path = commandPath(leaf);
    if (path in COMMANDS_WITHOUT_PROJECT) continue;
    if (path in COMMANDS_WITH_OWN_PROJECT_FLAG) continue;
    if (!leaf.options.some((option) => option.long === "--project")) {
      leaf.option("--project <idOrSlug>", PROJECT_FLAG_HELP);
    }
    (leaf as unknown as Record<symbol, boolean>)[PROJECT_SCOPED] = true;
  }
};

/** Whether this command's `--project` names the project it runs against. */
export const isProjectScoped = (cmd: Command): boolean =>
  (cmd as unknown as Record<symbol, boolean>)[PROJECT_SCOPED] === true;

/**
 * The project the command about to run was pointed at, from its OWN options: a bespoke `--project`
 * elsewhere in the chain means something else and must not decide this request's identity.
 */
export const projectSelectorOf = (cmd: Command): string | undefined => {
  if (!isProjectScoped(cmd)) return undefined;
  const value = cmd.opts<{ project?: unknown }>().project;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};
