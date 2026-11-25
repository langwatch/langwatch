import { describe, expect, it } from "vitest";

import { applyEdits } from "../ast.ts";
import { drawerGround } from "../transforms/drawer-ground.ts";

const file = "modules/example/browser/src/ui/sections/example-drawer.tsx";
const IMPORT = `import { Drawer } from "@langwatch/design-system/drawer";\n`;
const run = (source: string) => {
  const outcome = drawerGround({ file, source });
  return { ...outcome, output: applyEdits({ source, edits: outcome.edits }) };
};

describe("drawer ground", () => {
  it("drops bg=bg from Drawer.Content and nothing else", () => {
    const { output, skips } = run(`${IMPORT}
      export const A = () => <Drawer.Root open><Drawer.Content bg="bg" data-testid="d" /></Drawer.Root>;
    `);
    expect(skips).toEqual([]);
    expect(output).toContain(`<Drawer.Content data-testid="d" />`);
  });

  it("keeps any other ground and records it", () => {
    const { edits, skips } = run(`${IMPORT}
      export const A = () => <Drawer.Root open><Drawer.Content bg="bg.panel" /></Drawer.Root>;
    `);
    expect(edits).toEqual([]);
    expect(skips.map((skip) => skip.reason)).toEqual([
      "Drawer.Content ground is not the default `bg`",
    ]);
  });

  it("records a spread instead of throwing", () => {
    const { edits, skips } = run(`${IMPORT}
      export const A = () => <Drawer.Root open><Drawer.Content {...props} /></Drawer.Root>;
    `);
    expect(edits).toEqual([]);
    expect(skips.map((skip) => skip.reason)).toEqual(["spreads props"]);
  });
});
