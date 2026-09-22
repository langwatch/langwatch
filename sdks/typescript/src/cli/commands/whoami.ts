import { loadConfig, isLoggedIn, type GovernanceConfig } from "@/cli/utils/governance/config";
import { commandAuthError } from "@/cli/utils/errorOutput";
import type { CommandResult } from "@/cli/utils/output";

/**
 * One line for what the login key reaches: the scope picked at approval,
 * otherwise invisible until a `--project` fails. Nothing is printed when
 * the field is absent -- no reach to state either way.
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
 * One line for what the login key can DO. "Whole organization" states
 * reach, not power: the key's permission list picked at approval, so a
 * covered command's 403 doesn't surprise. Absent when the login predates it.
 */
export const loginKeyPermissionsLine = (
  scope: GovernanceConfig["cli_api_key_scope"],
): string | undefined => {
  if (!scope?.permissions || scope.permissions.length === 0) return undefined;
  return `Permissions:  ${[...scope.permissions].toSorted().join(", ")}`;
};

/**
 * Whichever of the named fields the config holds, or nothing when it holds
 * none: a group with no field is omitted rather than emitted as `{}`.
 */
const definedFields = (
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined => {
  const held = Object.entries(fields).filter(([, value]) => value !== undefined);
  return held.length > 0 ? Object.fromEntries(held) : undefined;
};

/**
 * The `-o json` document, field by field from an explicit allowlist and never
 * a spread of `cfg` — which is a credential store, so a spread would publish
 * the next secret it grows.
 */
const buildWhoamiJson = (cfg: GovernanceConfig): Record<string, unknown> => {
  const user = definedFields({
    id: cfg.user?.id,
    email: cfg.user?.email,
    name: cfg.user?.name,
  });
  const organization = definedFields({
    id: cfg.organization?.id,
    slug: cfg.organization?.slug,
    name: cfg.organization?.name,
  });
  const personalProject = definedFields({
    id: cfg.personal_project?.id,
    slug: cfg.personal_project?.slug,
    name: cfg.personal_project?.name,
  });
  const scope = definedFields({
    kind: cfg.cli_api_key_scope?.kind,
    project_ids: cfg.cli_api_key_scope?.project_ids,
    permissions: cfg.cli_api_key_scope?.permissions,
  });

  return {
    ...(user ? { user } : {}),
    ...(organization ? { organization } : {}),
    ...(personalProject ? { personal_project: personalProject } : {}),
    ...(scope ? { cli_api_key_scope: scope } : {}),
    ...(cfg.gateway_url === undefined ? {} : { gateway_url: cfg.gateway_url }),
    ...(cfg.control_plane_url === undefined
      ? {}
      : { control_plane_url: cfg.control_plane_url }),
  };
};

/**
 * `langwatch whoami` — the persisted device-flow identity on the output port:
 * the allowlisted fields as `data`, the human lines as `table`, a logged-out
 * run thrown through the port's error shape.
 */
export const whoamiCommand = async (): Promise<CommandResult> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    // Thrown, not returned: `program.ts` renders it through
    // `reportCommandError`, and the brand is what keeps a local precondition
    // from being read as a `network_error`.
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
