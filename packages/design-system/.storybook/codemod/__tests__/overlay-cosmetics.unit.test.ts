import { describe, expect, it } from "vitest";

import { applyEdits } from "../ast.ts";
import { overlayCosmetics } from "../transforms/overlay-cosmetics.ts";

const file = "modules/example/browser/src/ui/blocks/example-dialog.tsx";
const run = (source: string) => {
  const outcome = overlayCosmetics({ file, source });
  return { ...outcome, output: applyEdits({ source, edits: outcome.edits }) };
};
const IMPORT = `import { Dialog } from "@langwatch/design-system/dialog";\n`;

describe("overlay cosmetics", () => {
  it("turns a literal maxWidth into the nearest Root size within 4rem", () => {
    const { output, skips } = run(`${IMPORT}
      export const A = () => (
        <Dialog.Root open>
          <Dialog.Content maxWidth="440px" data-testid="d" />
        </Dialog.Root>
      );
    `);
    expect(skips).toEqual([]);
    expect(output).toContain(`<Dialog.Root size="sm" open>`);
    expect(output).toContain(`<Dialog.Content data-testid="d" />`);
  });

  it("rewrites an existing Root size and reads maxW", () => {
    const { output } = run(`${IMPORT}
      export const A = () => (
        <Dialog.Root open size="xl"><Dialog.Content maxW="500px" /></Dialog.Root>
      );
    `);
    expect(output).toContain(`<Dialog.Root open size="md"><Dialog.Content /></Dialog.Root>`);
  });

  it("skips a width more than 4rem from any size, another width prop, a dynamic size", () => {
    const cases: [string, string][] = [
      [
        `<Dialog.Root open><Dialog.Content maxWidth="1200px" /></Dialog.Root>`,
        "1200px is more than 4rem from any size",
      ],
      [
        `<Dialog.Root open><Dialog.Content maxWidth="440px" width="full" /></Dialog.Root>`,
        "Content has another width prop",
      ],
      [
        `<Dialog.Root open size={size}><Dialog.Content maxWidth="440px" /></Dialog.Root>`,
        "Root size is not a plain size",
      ],
      [
        `<Dialog.Root open><Dialog.Content maxWidth={{ base: "90%", md: "440px" }} /></Dialog.Root>`,
        "maxWidth is not a literal px or rem",
      ],
    ];
    for (const [jsx, reason] of cases) {
      const { edits, skips } = run(`${IMPORT}export const A = () => (${jsx});`);
      expect(edits).toEqual([]);
      expect(skips.map((skip) => skip.reason)).toEqual([reason]);
    }
  });
});
