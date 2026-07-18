/**
 * `langwatch help-tree` — the whole command tree as a compact indented
 * listing with `# hint:` / `# skill:` annotations (gcx `help-tree` clone),
 * sized for injection into an agent's context window.
 *
 * Plain text in both human AND agent mode — the tree already is the compact
 * agent format. An explicit machine format (`-o json`, `-o yaml`, `--jq`)
 * emits the underlying catalog structure instead.
 */
import { buildProgram } from "../program";
import { buildCatalog, renderHelpTree } from "../utils/commandCatalog";
import {
  printResult,
  resolveOutputOptions,
  type RawOutputFlags,
} from "../utils/output";

export const helpTreeCommand = async (
  options?: RawOutputFlags,
): Promise<void> => {
  const catalog = buildCatalog(buildProgram());
  const { format } = resolveOutputOptions({ ...options });

  if (format !== "json" && format !== "yaml") {
    console.log(renderHelpTree(catalog));
    return;
  }

  await printResult(
    { commands: catalog },
    { ...options, table: () => console.log(renderHelpTree(catalog)) },
  );
};
