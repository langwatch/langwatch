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
import { printResult, type RawOutputFlags } from "../utils/output";

/** Whether the caller asked for a format explicitly (any spelling). */
const hasExplicitFormatRequest = (options?: RawOutputFlags): boolean =>
  options?.output !== undefined ||
  options?.json !== undefined ||
  options?.jq !== undefined ||
  options?.format === "json";

export const helpTreeCommand = async (
  options?: RawOutputFlags,
): Promise<void> => {
  const catalog = buildCatalog(buildProgram());

  if (!hasExplicitFormatRequest(options)) {
    console.log(renderHelpTree(catalog));
    return;
  }

  await printResult(
    { commands: catalog },
    { ...options, table: () => console.log(renderHelpTree(catalog)) },
  );
};
