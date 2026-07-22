/**
 * `langwatch commands` — the machine-readable catalog of every CLI command
 * (gcx `commands` clone). Path, args, flags, description, feature-map hint,
 * skill annotation, and a token-cost estimate per command, built live from
 * the commander tree so it can never drift from what actually runs.
 *
 * Nested by default (groups with children); `--flat` flattens to a single
 * list. The human rendering is the same compact tree `help-tree` prints.
 */
import { buildProgram } from "../program";
import {
  buildCatalog,
  flattenCatalog,
  renderHelpTree,
} from "../utils/commandCatalog";
import type { CommandResult, RawOutputFlags } from "../utils/output";

export interface CommandsOptions extends RawOutputFlags {
  /** Flatten the command tree to a single list. */
  flat?: boolean;
}

export const commandsCommand = (
  options?: CommandsOptions,
): CommandResult => {
  const catalog = buildCatalog(buildProgram());
  return {
    data: { commands: options?.flat ? flattenCatalog(catalog) : catalog },
    table: () => console.log(renderHelpTree(catalog)),
  };
};
