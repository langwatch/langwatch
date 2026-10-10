/**
 * Machine-readable CLI command catalog built live from commander tree
 * (nested by default; --flat to flatten).
 */
import { buildProgram } from "../program";
import { buildCatalog, flattenCatalog, renderHelpTree } from "../utils/commandCatalog";
import type { CommandResult, RawOutputFlags } from "../utils/output";

export interface CommandsOptions extends RawOutputFlags {
  /** Flatten the command tree to a single list. */
  flat?: boolean;
}

export const commandsCommand = (options?: CommandsOptions): CommandResult => {
  const catalog = buildCatalog(buildProgram());
  return {
    data: { commands: options?.flat ? flattenCatalog(catalog) : catalog },
    table: () => console.log(renderHelpTree(catalog)),
  };
};
