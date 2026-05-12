/**
 * @vitest-environment node
 *
 * Source-level guards for hydration warnings caused by block-level descendants
 * of Chakra `<Text>` (which renders `<p>`) in MainMenu and its sidebar helpers.
 * React flags this as "In HTML, <div> cannot be a descendant of <p>" and warns
 * on every render.
 *
 * History:
 *   - lw#3586 F12 introduced placeholder `<div>&nbsp;</div>` inside compact-mode
 *     `<Text>` for the "Evaluate", "Library", "Gateway", "Ops" section labels.
 *   - lw#3700 fixed this by switching the placeholders to Fragments (`<>&nbsp;</>`).
 *   - lw#3199 verifies the fix sticks and broadens the source-text guard so
 *     future regressions in MainMenu.tsx OR any of the sidebar/ helpers it
 *     composes are caught at unit-test time.
 *
 * A source-text scan is enough here because the offending patterns are
 * unambiguous and Chakra's `<Text>` consistently renders as `<p>`. A full
 * render test would require mocking the router, project context, nav store,
 * tRPC client, and Chakra system — disproportionate for a 4-character class
 * of fix that hasn't recurred since #3700.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS_DIR = path.join(__dirname, "..");
const SIDEBAR_DIR = path.join(COMPONENTS_DIR, "sidebar");
const MAIN_MENU = path.join(COMPONENTS_DIR, "MainMenu.tsx");

const sidebarSources = readdirSync(SIDEBAR_DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => path.join(SIDEBAR_DIR, f));

const allMainMenuSources = [MAIN_MENU, ...sidebarSources];

const BLOCK_LEVEL_CHAKRA_CHILDREN =
  /<(div|Box|HStack|VStack|Flex|Stack|Grid|Spacer|Group|Wrap|Center|Divider|Container|Progress|Collapsible)\b/;

function findTextBlockOffenders(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const re = /<Text\b[^>]*>([\s\S]*?)<\/Text>/g;
  const offenders: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (BLOCK_LEVEL_CHAKRA_CHILDREN.test(m[1] ?? "")) {
      const lineNum = src.slice(0, m.index).split("\n").length;
      offenders.push(`${path.basename(file)}:${lineNum}`);
    }
  }
  return offenders;
}

describe("MainMenu hydration guards (lw#3586 F12, lw#3199)", () => {
  /** @scenario MainMenu compact-mode placeholders use Fragments not divs to avoid hydration warnings */
  it("MainMenu.tsx does not render <div>&nbsp;</div> inside <Text> (would hydration-warn)", () => {
    const file = readFileSync(MAIN_MENU, "utf8");
    expect(file).not.toMatch(/<div>&nbsp;<\/div>/);
  });

  it("MainMenu.tsx uses Fragment <>&nbsp;</> for compact placeholders", () => {
    const file = readFileSync(MAIN_MENU, "utf8");
    expect(file).toMatch(/<>&nbsp;<\/>/);
  });

  /** @scenario Sidebar helpers avoid <div>&nbsp;</div> placeholders in <Text> blocks */
  it("no MainMenu or sidebar source uses <div>&nbsp;</div> as a placeholder", () => {
    const offenders = allMainMenuSources.filter((f) =>
      /<div>&nbsp;<\/div>/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  /** @scenario No <Text> in MainMenu's render tree contains a block-level Chakra child */
  it("no <Text> block in MainMenu or sidebar wraps a block-level Chakra component", () => {
    const offenders = allMainMenuSources.flatMap(findTextBlockOffenders);
    expect(offenders).toEqual([]);
  });
});
