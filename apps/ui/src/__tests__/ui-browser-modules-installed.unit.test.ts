import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { browserModules } from "../browser-modules.generated";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Every module directory under `root` that ships a browser half. */
function modulesWithBrowserHalf(root: string): string[] {
  const modulesDir = join(repoRoot, root);
  return readdirSync(modulesDir).filter((name) =>
    existsSync(join(modulesDir, name, "browser", "package.json")),
  );
}

describe("given every module that ships a browser half", () => {
  describe("when the installed browser module list is composed", () => {
    /** @scenario "A new module cannot be half-registered" */
    it("names every one of them, so none is left out by hand", () => {
      const onDisk = [
        ...modulesWithBrowserHalf("modules"),
        ...modulesWithBrowserHalf("enterprise/modules"),
      ].toSorted();
      const installed = browserModules.map((declaration) => declaration.name).toSorted();

      expect(onDisk.length).toBeGreaterThan(0);
      expect(installed).toEqual(onDisk);
    });
  });
});
