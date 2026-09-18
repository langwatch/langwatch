/**
 * Pins the panel's ambient texture layer (spec: specs/langy/langy-panel-theme.feature).
 * The token-emission half of this spec moved with `langyThemeConfig` to
 * `@langwatch/langy-browser-kit` — see its `ui/elements/__tests__/langy-theme.unit.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("given the panel's ambient textures in langy-theme.css", () => {
  const css = readFileSync(
    /**
     * Read as a FILE rather than imported: the assertions are about the CSS
     * text, and a bundler would hand back a module.
     */
    join(import.meta.dirname, "../langy-theme.css"),
    "utf8",
  );
  // One rule per selector in the sheet, so anchoring on the selector and
  // reading to the closing brace captures that rule's whole body.
  const ruleBody = (selector: string) => {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  /** @scenario Ambient textures are a dark-mode treatment */
  it("hides the wash and signal grid until the dark gate turns them on", () => {
    // Both textures ship hidden, so the light panel stays the app's clean
    // surface...
    expect(ruleBody(".langy-wash {")).toContain("display: none");
    expect(ruleBody(".langy-signal-grid {")).toContain("display: none");
    // ...and only the .dark gate reveals them on the ink ground.
    expect(ruleBody(".dark .langy-root .langy-wash")).toContain("display: block");
    expect(ruleBody(".dark .langy-signal-grid")).toContain("display: block");
    // The film-grain overlay is gone from both grounds, not merely gated.
    expect(css).not.toContain(".langy-grain");
  });
});
