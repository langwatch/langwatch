import { describe, expect, it } from "vitest";

import { applyEdits } from "../ast.ts";
import { pixelSpacing, tokenFor } from "../transforms/pixel-spacing.ts";

const file = "modules/example/browser/src/ui/example.tsx";
const run = (source: string) => {
  const outcome = pixelSpacing({ file, source });
  return { ...outcome, output: applyEdits({ source, edits: outcome.edits }) };
};

describe("pixel spacing to tokens", () => {
  it("maps a pixel value on the scale to its token", () => {
    expect(tokenFor({ value: "16px", prop: "padding" })).toBe("4");
    expect(tokenFor({ value: "2px", prop: "gap" })).toBe("0.5");
    expect(tokenFor({ value: "-8px", prop: "marginTop" })).toBe("-2");
    expect(tokenFor({ value: "0px", prop: "padding" })).toBe("0");
  });

  it("refuses values off the scale and negative padding", () => {
    expect(tokenFor({ value: "7px", prop: "padding" })).toBeUndefined();
    expect(tokenFor({ value: "72px", prop: "padding" })).toBeUndefined();
    expect(tokenFor({ value: "-8px", prop: "paddingTop" })).toBeUndefined();
    expect(tokenFor({ value: "8px 16px", prop: "padding" })).toBeUndefined();
  });

  it("converts props and inline style objects on design-system elements", () => {
    const { output, skips } = run(`
      import { Box, HStack } from "@langwatch/design-system/primitives";
      export const A = () => (
        <HStack gap="8px" px={"12px"} css={{ "& td": { paddingY: "4px" } }}>
          <Box marginTop="-4px" />
        </HStack>
      );
    `);
    expect(output).toContain(`<HStack gap="2" px="3" css={{ "& td": { paddingY: "1" } }}>`);
    expect(output).toContain(`<Box marginTop="-1" />`);
    expect(skips).toEqual([]);
  });

  it("lists what it leaves alone, with the reason", () => {
    const { edits, skips } = run(`
      import { Box } from "@langwatch/design-system/primitives";
      import { Local } from "./local.tsx";
      const shared = { padding: "8px" };
      export const A = () => (
        <>
          <Box padding="7px" />
          <Box margin="0 8px" />
          <Box style={{ padding: 8 }} />
          <Local gap="8px" />
          <div style={{ marginTop: "4px" }} />
          <Box css={{ padding: pick({ padding: "8px" }) }} />
        </>
      );
    `);
    expect(edits).toEqual([]);
    expect(skips.map((skip) => skip.reason)).toEqual([
      "style object not written inline on a JSX element",
      "off the spacing scale (never rounded)",
      "not a single pixel value",
      "React `style` takes raw CSS, not tokens",
      "`Local` is not a design-system element",
      "React `style` takes raw CSS, not tokens",
      "inside a computed expression",
    ]);
  });

  it("leaves token values, rem values and numbers outside style alone", () => {
    const { changes, skips } = run(`
      import { Box } from "@langwatch/design-system/primitives";
      export const A = () => <Box padding={4} margin="1rem" gap="2" />;
    `);
    expect(changes).toEqual([]);
    expect(skips).toEqual([]);
  });
});
