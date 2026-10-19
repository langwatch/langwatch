/**
 * Help tree: compact indented listing with `# hint:` / `# skill:` annotations.
 * Plain text by default (both human and auto-detected agent). Explicit format
 * requests (`-o json`) emit the catalog structure instead.
 */
import { buildProgram } from "../program";
import { buildCatalog, renderHelpTree } from "../utils/commandCatalog";
import { hasExplicitFormatRequest, type CommandResult, type RawOutputFlags } from "../utils/output";

export const helpTreeCommand = (options?: RawOutputFlags): CommandResult | void => {
  const catalog = buildCatalog(buildProgram());

  // Auto-detected agent mode still gets the tree: it IS the compact agent
  // format, so returning a result here would hand the port an `agents` format
  // it would serialise to JSON — the one output this command deliberately does
  // not emit unless asked. Only an EXPLICIT request goes through the port.
  if (!hasExplicitFormatRequest(options)) {
    console.log(renderHelpTree(catalog));
    return;
  }

  return {
    data: { commands: catalog },
    table: () => console.log(renderHelpTree(catalog)),
  };
};
