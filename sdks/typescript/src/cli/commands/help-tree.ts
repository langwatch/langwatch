/**
 * `langwatch help-tree` — the whole command tree as a compact indented
 * listing with `# hint:` / `# skill:` annotations (gcx `help-tree` clone),
 * sized for injection into an agent's context window.
 *
 * Plain text in both human AND auto-detected agent mode — the tree already is
 * the compact agent format. Any EXPLICIT machine request (`-o json|agents|
 * yaml`, `--json`, `--jq`, `-f json`) emits the underlying catalog structure
 * instead: an explicit `-o agents` is a request for compact JSON, not for the
 * tree an agent caller would have gotten anyway.
 */
import { buildProgram } from "../program";
import { buildCatalog, renderHelpTree } from "../utils/commandCatalog";
import {
  hasExplicitFormatRequest,
  type CommandResult,
  type RawOutputFlags,
} from "../utils/output";

export const helpTreeCommand = (
  options?: RawOutputFlags,
): CommandResult | void => {
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
