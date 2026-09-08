import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  type MarkColourSite,
  markColourSites,
} from "../../../test-utils/markColourScan";
import { parseSourceTexts } from "../../../test-utils/tsAst";

/**
 * A chart mark is drawn in a chart colour.
 *
 * Two rules from `specs/ai-governance/dashboard/governance-ui-controls.feature`
 * are enforced here, both negative:
 *
 *   - a mark is not painted in a token meant for reading text;
 *   - a mark is not painted in the colour a screen uses for good or for bad.
 *
 * **This file is the second attempt, and the first one is why it looks like
 * this.** The first was a regular expression over source text. It went green
 * against `var(--chakra-colors-gray-fg)` — a near-black reading ink, the exact
 * thing the rule exists to forbid — because it checked that a token was spelled
 * `<family>-<suffix>` rather than checking which family. Four adversarial
 * readers then found five more ways past it. Rather than patch a sixth hole
 * into a regex, the reading moved to the parser the repo already owns, where
 * the whole class is answered by construction. See `markColourScan`.
 *
 * The snippet cases below pin the rule itself. They are first, and they are not
 * decoration: each is a form that beat the previous version, so a future
 * simplification that reintroduces text matching turns them red before it ever
 * reaches the tree. The tree case that follows is worth little without them —
 * it passes whenever the codebase happens to be clean, including when the scan
 * has stopped reading.
 */

const PACKAGE_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const ROOTS = [
  "src/components/governance",
  "src/pages/governance",
  "src/components/settings/governance",
].map((relative) => join(PACKAGE_ROOT, relative));

/**
 * Counted in FILES, not findings, and calibrated by EXECUTION against the live
 * tree: 73 non-test sources across the three roots, 48 + 12 + 13. The previous
 * version of this file claimed 210 and set the floor at 150, which was a number
 * nobody had run — a fourth root, `src/features/governance`, does not exist and
 * contributed nothing. A floor above the true count would have failed honestly;
 * this one is under it, which is the point of a floor.
 */
const SCANNED_FILE_FLOOR = 60;

/**
 * Reading ink, in two shapes, and the second one is the whole reason the first
 * version of this file was worthless.
 *
 *   - the `fg` FAMILY: `fg.muted`, `fg.emphasized`, `fg.inverted`;
 *   - the `fg` STEP of ANY family: `gray.fg`, `blue.fg`, `orange.fg`. Every
 *     family in Chakra carries an `fg` step, and that step is the near-black
 *     the family uses for text on its own surface.
 *
 * `var(--chakra-colors-gray-fg)` is the exact value that passed the previous
 * version green, and anything reading only the family name lets it through. A
 * guard that checks the family and not the step is looking at the wrong half
 * of the token.
 */
const INK =
  /^(?:var\(--chakra-colors-)?fg[.\-]|[.\-]fg\)?$|^#(?:0{6}|1[0-9a-f]{5}|2d2d3d|3d3d4d|111113)$/i;

/**
 * Green and red where they are DRAWN — the solid, emphasized and fg steps, and
 * the palette's own hexes — in the token spelling and the CSS-variable spelling
 * alike.
 *
 * The pale end of the scale is deliberately not here, and this is a rule rather
 * than an escape hatch carved to make a run go green. A `red.50` is a container
 * wash: it tints a panel behind text, it is not legible as a line or a bar, and
 * nothing is ever drawn in it. Two live uses proved the distinction — an error
 * surface on a credential picker and a warning drawer, both settings panels
 * stating a verdict a person configured, which is exactly the badge case the
 * spec already carves out. Judging them here would have forced a file
 * exemption, and a file exemption blinds the guard to everything else in the
 * file.
 */
const DIRECTION =
  /^(?:var\(--chakra-colors-)?(?:green|red)[.\-](?:solid|emphasized|fg)\b|^#(?:22c55e|16a34a|ef4444|dc2626)$/i;

/**
 * Axis ticks ARE text — they are labels on a chart, not marks on it — so the
 * ink rule does not apply to them. Named as a declaration rather than matched
 * by proximity: a mark inside a component belongs to that component, even when
 * a tick constant happens to sit a few lines above it.
 */
const TEXT_ROLE_EXCEPTIONS = new Set(["CHART_AXIS_TICK"]);

function collectFiles(directory: string): string[] {
  const found: string[] = [];
  let entries: string[];

  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }

  for (const entry of entries) {
    const path = join(directory, entry);

    try {
      if (statSync(path).isDirectory()) {
        found.push(...collectFiles(path));
        continue;
      }
    } catch {
      // A file another agent deleted between the listing and the stat. Skip it
      // rather than fail the suite on a race nobody can reproduce.
      continue;
    }

    if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }

  return found;
}

function sitesIn(fileName: string, sourceText: string): MarkColourSite[] {
  const [parsed] = parseSourceTexts({ sources: [{ fileName, sourceText }] });
  return parsed ? markColourSites(parsed.source) : [];
}

describe("governance chart marks", () => {
  describe("the rule itself, pinned on the forms that beat the last version", () => {
    it("reads a colour held in a constant, not just one written inline", () => {
      const sites = sitesIn(
        "constant.tsx",
        `const SPARK = "fg.muted";
         export const C = () => <Line stroke={SPARK} />;`,
      );

      expect(sites).toContainEqual(
        expect.objectContaining({ role: "stroke", value: "fg.muted" }),
      );
    });

    it("reads both branches of a ternary, not only the one it reaches first", () => {
      const sites = sitesIn(
        "ternary.tsx",
        `export const C = ({ on }) => <Line stroke={on ? "blue.solid" : "fg.muted"} />;`,
      );

      expect(
        sites.flatMap((s) => (s.kind === "literal" ? [s.value] : [])),
      ).toEqual(expect.arrayContaining(["blue.solid", "fg.muted"]));
    });

    it("reads an attribute whose value sits on another line", () => {
      const sites = sitesIn(
        "multiline.tsx",
        `export const C = () => (
           <Line
             stroke=
               "fg.muted"
           />
         );`,
      );

      expect(sites).toContainEqual(
        expect.objectContaining({ value: "fg.muted" }),
      );
    });

    it.each([
      "backgroundColor",
      "background",
      "bgColor",
      "bg",
      "trackColor",
      "colorPalette",
      "fill",
    ])("reads the %s spelling of painting a thing", (role) => {
      const sites = sitesIn(
        `${role}.tsx`,
        `export const C = () => <Box ${role}="fg.muted" />;`,
      );

      expect(sites).toContainEqual(
        expect.objectContaining({ role, value: "fg.muted" }),
      );
    });

    it("reads a colour inside a shared theme object, the form a constant file uses", () => {
      const sites = sitesIn(
        "theme.ts",
        `export const CHART_AXIS_TICK = { fill: "fg.muted", fontSize: 11 };`,
      );

      expect(sites).toContainEqual(
        expect.objectContaining({ role: "fill", value: "fg.muted" }),
      );
    });

    it("reads an exported constant whose own name says it holds a mark colour", () => {
      // The form that escaped everything until a falsification sweep found it:
      // the section's single most important mark colour is a top-level
      // constant, touching no attribute in the file that declares it.
      const sites = sitesIn(
        "exported.ts",
        `export const CHART_SPARK_STROKE = "var(--chakra-colors-gray-fg)";`,
      );

      expect(sites).toContainEqual(
        expect.objectContaining({
          role: "CHART_SPARK_STROKE",
          value: "var(--chakra-colors-gray-fg)",
        }),
      );
    });

    it("admits what it cannot answer instead of calling it clean", () => {
      const sites = sitesIn(
        "imported.tsx",
        `import { ELSEWHERE } from "./other";
         export const C = () => <Line stroke={ELSEWHERE} />;`,
      );

      expect(sites).toContainEqual(
        expect.objectContaining({ kind: "unresolved", role: "stroke" }),
      );
    });

    it.each([
      ["the token spelling", "fg.muted"],
      [
        "the CSS variable the token compiles to",
        "var(--chakra-colors-fg-muted)",
      ],
      ["a raw near-black", "#1a1a1a"],
      ["a family the first version never listed", "fg.emphasized"],
      [
        "the fg STEP of another family, the original kill",
        "var(--chakra-colors-gray-fg)",
      ],
      ["the same kill in token spelling", "gray.fg"],
      ["the fg step of a chart family", "blue.fg"],
    ])("judges %s as ink", (_label, value) => {
      expect(INK.test(value)).toBe(true);
    });

    it.each([
      ["the good colour as a token", "green.solid"],
      ["the good colour as a variable", "var(--chakra-colors-green-solid)"],
      ["the good colour as the palette's own hex", "#22c55e"],
      ["the bad colour", "red.solid"],
      ["the good colour at its emphasized step", "green.emphasized"],
    ])("judges %s as a direction colour", (_label, value) => {
      expect(DIRECTION.test(value)).toBe(true);
    });

    it.each([
      "red.50",
      "green.100",
      "red.200",
    ])("leaves the pale step %s alone, because a wash is a surface and not a mark", (tint) => {
      expect(DIRECTION.test(tint)).toBe(false);
    });

    it("leaves a chart colour alone under both rules", () => {
      for (const allowed of [
        "blue.solid",
        "var(--chakra-colors-blue-solid)",
        "#3b82f6",
      ]) {
        expect(INK.test(allowed)).toBe(false);
        expect(DIRECTION.test(allowed)).toBe(false);
      }
    });
  });

  describe("the governance screens themselves", () => {
    const files = ROOTS.flatMap(collectFiles);
    const parsed = parseSourceTexts({
      sources: files.map((path) => ({
        fileName: path,
        sourceText: readFileSync(path, "utf8"),
      })),
    });

    const sites = parsed.flatMap(({ fileName, source }) =>
      markColourSites(source).map((site) => ({ ...site, fileName })),
    );

    it("reads the whole governance surface, not a directory that moved", () => {
      expect(files.length).toBeGreaterThan(SCANNED_FILE_FLOOR);
      expect(sites.filter((s) => s.kind === "literal").length).toBeGreaterThan(
        20,
      );
    });

    /** @scenario "A chart's marks are drawn in chart colours, never in text colours" */
    it("paints no mark in a token meant for reading text", () => {
      expect(
        sites
          .filter(
            (site) =>
              site.kind === "literal" &&
              INK.test(site.value) &&
              !TEXT_ROLE_EXCEPTIONS.has(site.fileName.split("/").pop() ?? "") &&
              !isTickConstant(site),
          )
          .map(
            (site) => `${site.fileName.replace(PACKAGE_ROOT, "")}:${site.line}`,
          ),
      ).toEqual([]);
    });

    /** @scenario "A card's mark is not painted in a direction colour" */
    it("paints no mark in the colour a screen uses for good or bad", () => {
      expect(
        sites
          .filter(
            (site) => site.kind === "literal" && DIRECTION.test(site.value),
          )
          .map(
            (site) => `${site.fileName.replace(PACKAGE_ROOT, "")}:${site.line}`,
          ),
      ).toEqual([]);
    });
  });
});

/**
 * Whether a site belongs to a constant the rules excuse. Kept as a function so
 * the exception is a named declaration rather than a line-distance heuristic.
 */
function isTickConstant(site: MarkColourSite & { fileName: string }): boolean {
  if (site.kind !== "literal") return false;

  const text = readFileSync(site.fileName, "utf8").split("\n");

  for (let index = site.line - 1; index >= 0; index -= 1) {
    const match = /^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=/.exec(
      text[index] ?? "",
    );
    if (match) return TEXT_ROLE_EXCEPTIONS.has(match[1] ?? "");
  }

  return false;
}
