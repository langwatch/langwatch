import {
  loadConfig,
  isLoggedIn,
  type GovernanceConfig,
} from "@/cli/utils/governance/config";
import { commandAuthError } from "@/cli/utils/errorOutput";
import type { CommandResult } from "@/cli/utils/output";

/**
 * One line for what the login key reaches. The key is minted from the scope
 * the user picked while approving, and that choice is invisible afterwards —
 * a `--project` that fails is otherwise the first sign of it. Nothing is
 * printed when the field is absent: the login predates the feature, or the
 * server does not mint login keys, and either way there is no reach to state.
 */
export const loginKeyScopeLine = (
  scope: GovernanceConfig["cli_api_key_scope"],
): string | undefined => {
  if (!scope) return undefined;
  if (scope.kind === "organization") return "Login key:    whole organization";
  const count = scope.project_ids.length;
  return `Login key:    ${count} project${count === 1 ? "" : "s"}`;
};

/**
 * One line for what the login key can DO. "Whole organization" states reach,
 * not power: the key carries the permission list picked at approval, and a
 * command the list does not cover is refused with a 403 that reads as a
 * surprise when `whoami` never said so. Nothing is printed when the login
 * predates the field.
 */
export const loginKeyPermissionsLine = (
  scope: GovernanceConfig["cli_api_key_scope"],
): string | undefined => {
  if (!scope?.permissions || scope.permissions.length === 0) return undefined;
  return `Permissions:  ${[...scope.permissions].sort().join(", ")}`;
};

/**
 * Copies the named keys off `source`, keeping only those it actually holds.
 *
 * Explicit allowlists as data, never a spread of the raw config: the persisted
 * config is a long-lived credential store (access/refresh tokens, project API
 * keys, personal VK secret, the org-wide CLI key), and a spread would leak the
 * next secret it grows without anyone noticing. One emptiness rule governs
 * both the field and the group: a field is `!== undefined`, and a group holding
 * no such field is dropped whole rather than emitted as `{}`.
 */
const pickDefined = <T extends object, K extends keyof T>(
  source: T | undefined,
  keys: readonly K[],
): Pick<T, K> | undefined => {
  if (!source) return undefined;
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return Object.keys(out).length > 0 ? (out as Pick<T, K>) : undefined;
};

/**
 * Builds the `--json`/`-o json` document field by field from the explicit
 * allowlists above, never by spreading `cfg`. Meant to be piped into other
 * tools, so a group is omitted entirely when the config does not hold it,
 * rather than emitted as an empty object.
 */
const buildWhoamiJson = (cfg: GovernanceConfig): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};

  const user = pickDefined(cfg.user, ["id", "email", "name"]);
  if (user) doc.user = user;

  const organization = pickDefined(cfg.organization, ["id", "slug", "name"]);
  if (organization) doc.organization = organization;

  const personalProject = pickDefined(cfg.personal_project, [
    "id",
    "slug",
    "name",
  ]);
  if (personalProject) doc.personal_project = personalProject;

  const scope = pickDefined(cfg.cli_api_key_scope, [
    "kind",
    "project_ids",
    "permissions",
  ]);
  if (scope) doc.cli_api_key_scope = scope;

  if (cfg.gateway_url !== undefined) doc.gateway_url = cfg.gateway_url;
  if (cfg.control_plane_url !== undefined) {
    doc.control_plane_url = cfg.control_plane_url;
  }

  return doc;
};

/**
 * `langwatch whoami` — prints the device-flow identity persisted at
 * ~/.langwatch/config.json. Mirrors `git config user.name` /
 * `gh auth status` ergonomics.
 *
 * Speaks the CLI output port: it returns the raw identity as `data` (from
 * `buildWhoamiJson`'s allowlist, so a new secret field on `GovernanceConfig`
 * cannot leak by accident) and the human form as `table`. `-o json`, `-o yaml`
 * and `--jq` all project from `data`; a logged-out run fails through the port's
 * error shape, so a machine caller gets structured output rather than chalk.
 */
export const whoamiCommand = async (): Promise<CommandResult> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    // Thrown, not returned: the port's registration in `program.ts` catches it
    // and renders it through `reportCommandError`, so `-o json` gets a
    // structured error rather than chalk prose. `Object.assign`ed onto a real
    // Error so eslint's only-throw-error is satisfied while
    // `handledErrorFromThrown` still reads the `not_authenticated` brand off
    // the thrown value — a bare `new Error(...)` here has no code the wire
    // shape recognises, so it was falling through to a guessed
    // `network_error` (wrong code, wrong "check your connection" advice for a
    // login precondition the CLI checked locally).
    const message =
      "Not logged in. Run `langwatch login --device` to sign in via your company SSO.";
    throw Object.assign(new Error(message), commandAuthError(message));
  }

  return {
    data: buildWhoamiJson(cfg),
    table: () => {
      if (cfg.user?.email) console.log(`User:         ${cfg.user.email}`);
      if (cfg.user?.name) console.log(`Name:         ${cfg.user.name}`);
      if (cfg.organization?.name) {
        console.log(`Organization: ${cfg.organization.name}`);
      }
      const scopeLine = loginKeyScopeLine(cfg.cli_api_key_scope);
      if (scopeLine) console.log(scopeLine);
      const permissionsLine = loginKeyPermissionsLine(cfg.cli_api_key_scope);
      if (permissionsLine) console.log(permissionsLine);
      console.log(`Gateway:      ${cfg.gateway_url}`);
      console.log(`Dashboard:    ${cfg.control_plane_url}`);
      if (cfg.default_personal_vk?.prefix) {
        console.log(`Personal VK:  ${cfg.default_personal_vk.prefix}…`);
      }
    },
  };
};
