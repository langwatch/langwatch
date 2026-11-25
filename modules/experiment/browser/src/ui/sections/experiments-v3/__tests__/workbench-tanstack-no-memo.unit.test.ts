import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The workbench renders headers and cells through TanStack's one mutable table,
// whose header and cell objects keep their identity while table meta (run
// handlers, evaluators) changes. A compiler-memoised renderer keeps the first
// meta, so a column run sent no evaluators. These files must opt out.
const optedOut = ["../workbench-table-head.tsx", "../../../elements/dataset/table-cell.tsx"];

describe("workbench table renderers", () => {
  it.each(optedOut)("%s opts out of React Compiler memoisation", (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
    expect(source).toMatch(/^\s*"use no memo";$/m);
  });
});
