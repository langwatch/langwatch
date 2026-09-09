import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createWorkspaceModuleResolver, moduleImports } from "../src/workspace/module-graph.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const resolver = createWorkspaceModuleResolver({ root });

describe("server roots used by both API and worker composition", () => {
  /** @scenario "Naming a feature server does not load its HTTP and RPC handlers" */
  it.each(["analytics", "gateway", "scenario", "trace"])(
    "%s keeps its transports outside the root import graph",
    { timeout: 120_000 },
    (feature) => {
      const source = join(root, "modules", feature, "server/src");
      const pending = [join(source, "index.ts")];
      const seen = new Set<string>();

      while (pending.length > 0) {
        const file = pending.pop();
        if (!file || seen.has(file)) {
          continue;
        }

        seen.add(file);

        for (const entry of moduleImports({ file })) {
          if (entry.nonLiteral) {
            continue;
          }

          const target = resolver.resolve({ file, specifier: entry.specifier });
          if (target) {
            pending.push(target);
          }
        }
      }

      const transports = [...seen]
        .filter((file) => file.startsWith(join(source, "transport") + sep))
        .map((file) => relative(root, file));

      expect(transports).toEqual([]);
    },
  );
});
