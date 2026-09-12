import chalk from "chalk";
import {
  loadConfig,
  isLoggedIn,
  type GovernanceConfig,
} from "@/cli/utils/governance/config";

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
 * Builds the `--json` document field by field from an explicit allowlist,
 * never by spreading `cfg`. The persisted config is a long-lived credential
 * store (access/refresh tokens, project API keys, personal VK secret, the
 * org-wide CLI key) and this output is meant to be piped into other tools —
 * a spread would leak the next secret the config grows without anyone
 * noticing. A field/sub-object is omitted entirely when the config does not
 * hold it, rather than emitted as `null`.
 */
const buildWhoamiJson = (cfg: GovernanceConfig): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};

  if (cfg.user?.id || cfg.user?.email || cfg.user?.name) {
    doc.user = {
      ...(cfg.user?.id !== undefined && { id: cfg.user.id }),
      ...(cfg.user?.email !== undefined && { email: cfg.user.email }),
      ...(cfg.user?.name !== undefined && { name: cfg.user.name }),
    };
  }

  if (cfg.organization?.id || cfg.organization?.slug || cfg.organization?.name) {
    doc.organization = {
      ...(cfg.organization?.id !== undefined && { id: cfg.organization.id }),
      ...(cfg.organization?.slug !== undefined && { slug: cfg.organization.slug }),
      ...(cfg.organization?.name !== undefined && { name: cfg.organization.name }),
    };
  }

  if (cfg.personal_project?.id || cfg.personal_project?.slug || cfg.personal_project?.name) {
    doc.personal_project = {
      ...(cfg.personal_project?.id !== undefined && { id: cfg.personal_project.id }),
      ...(cfg.personal_project?.slug !== undefined && { slug: cfg.personal_project.slug }),
      ...(cfg.personal_project?.name !== undefined && { name: cfg.personal_project.name }),
    };
  }

  if (cfg.cli_api_key_scope) {
    doc.cli_api_key_scope = {
      kind: cfg.cli_api_key_scope.kind,
      project_ids: cfg.cli_api_key_scope.project_ids,
      ...(cfg.cli_api_key_scope.permissions !== undefined && {
        permissions: cfg.cli_api_key_scope.permissions,
      }),
    };
  }

  if (cfg.gateway_url !== undefined) doc.gateway_url = cfg.gateway_url;
  if (cfg.control_plane_url !== undefined) doc.control_plane_url = cfg.control_plane_url;

  return doc;
};

/**
 * `langwatch whoami` — prints the device-flow identity persisted at
 * ~/.langwatch/config.json. Mirrors `git config user.name` /
 * `gh auth status` ergonomics. `--json` prints a secret-free machine-readable
 * snapshot instead, built via `buildWhoamiJson`'s allowlist so a new secret
 * field added to `GovernanceConfig` later can't leak by accident.
 */
export const whoamiCommand = async (options?: { json?: boolean }): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(
      chalk.yellow("Not logged in. Run `langwatch login --device` to sign in via your company SSO."),
    );
    process.exit(1);
    return;
  }

  if (options?.json) {
    console.log(JSON.stringify(buildWhoamiJson(cfg), null, 2));
    return;
  }

  if (cfg.user?.email) console.log(`User:         ${cfg.user.email}`);
  if (cfg.user?.name) console.log(`Name:         ${cfg.user.name}`);
  if (cfg.organization?.name) console.log(`Organization: ${cfg.organization.name}`);
  const scopeLine = loginKeyScopeLine(cfg.cli_api_key_scope);
  if (scopeLine) console.log(scopeLine);
  const permissionsLine = loginKeyPermissionsLine(cfg.cli_api_key_scope);
  if (permissionsLine) console.log(permissionsLine);
  console.log(`Gateway:      ${cfg.gateway_url}`);
  console.log(`Dashboard:    ${cfg.control_plane_url}`);
  if (cfg.default_personal_vk?.prefix) {
    console.log(`Personal VK:  ${cfg.default_personal_vk.prefix}…`);
  }
};
