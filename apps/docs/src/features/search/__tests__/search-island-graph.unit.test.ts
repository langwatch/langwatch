import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COMPONENT_RUNTIME, islandPackages } from "../../../testing/island-packages.ts";

const entry = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "browser/search.ts",
);

describe("when a reader opens search", () => {
  /** @scenario "Load the search engine without a schema library" */
  it("loads no schema validation library with the search island", () => {
    const packages = islandPackages({ entry });
    expect(packages.filter((name) => name === "zod" || name.startsWith("zod/"))).toEqual([]);
  });

  /** @scenario "Open search on the prerendered command bar" */
  it("loads no component runtime or design system code with the search island", () => {
    expect(islandPackages({ entry }).filter((name) => COMPONENT_RUNTIME.test(name))).toEqual([]);
  });
});
