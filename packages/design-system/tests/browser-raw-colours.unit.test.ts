import { describe, expect, it } from "vitest";

import {
  collectRawColours,
  isAllowedRawColourFile,
  isBrowserColourSource,
  rawColourSites,
} from "../.storybook/raw-colours.ts";

const file = "modules/example/browser/src/ui/example.tsx";

describe("browser raw colour guard", () => {
  /** @scenario "Browser colours use semantic tokens outside documented artwork" */
  it("rejects colour literals outside the documented allow-list", () => {
    expect(collectRawColours()).toEqual([]);
  });

  it.each([
    'const ink = "#123";',
    'const ink = "#1234";',
    'const ink = "#123456";',
    'const ink = "#12345678";',
    '<path fill="rgb(10, 20, 30)" />',
    '<path fill="rgba(10, 20, 30, 0.5)" />',
    "const style = `box-shadow: 0 0 2px #abcdef;`;",
    "const style = `color: ${ink}; background: #abcdef;`;",
    'const ink = "hsl(30 50% 50%)";',
    'const ink = "oklch(0.7 0.1 30)";',
    'const ink = "color(display-p3 0.9 0.5 0.1)";',
  ])("detects literal colour in %s", (source) => {
    expect(rawColourSites({ file, source })).toHaveLength(1);
  });

  it.each([
    '// The upstream library defaults to "#666".\nconst ink = "fg";',
    "/** A bare `#123` is a pull request reference. */",
    "const ink = `rgb(${r}, ${g}, ${b})`;",
    "const ink = `rgba(${r}, ${g}, ${b}, ${alpha})`;",
    "const ink = `oklch(0.62 0.14 ${hue})`;",
    'const ink = "var(--chakra-colors-fg)";',
    'const ink = getRawColorValue("blue.solid");',
    'const message = "See issue #3087).";',
    'const message = "Refund for order #4471.";',
    'const anchor = "#abcdef-title";',
  ])("ignores nonliteral colours and comments in %s", (source) => {
    expect(rawColourSites({ file, source })).toEqual([]);
  });

  it("limits exceptions to exact documented paths", () => {
    expect(isAllowedRawColourFile("modules/auth/browser/src/ui/elements/google-icon.tsx")).toBe(
      true,
    );
    expect(isAllowedRawColourFile("modules/auth/browser/src/ui/elements/new-icon.tsx")).toBe(false);
  });

  it.each([
    [file, true],
    ["apps/ui/src/shell/theme.ts", true],
    ["enterprise/modules/governance/browser/src/chart.tsx", true],
    ["modules/example/browser/src/chart.stories.tsx", false],
    ["modules/example/browser/src/__tests__/chart.tsx", false],
    ["modules/example/browser/src/chart.unit.test.ts", false],
    ["packages/design-system/src/system/config.ts", false],
    ["modules/example/process/src/chart.ts", false],
  ])("scopes %s to browser production code: %s", (path, included) => {
    expect(isBrowserColourSource(path)).toBe(included);
  });
});
