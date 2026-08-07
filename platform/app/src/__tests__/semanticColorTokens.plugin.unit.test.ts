import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Exercises biome-plugins/semantic-color-tokens.grit through Biome itself.
 *
 * A lint rule can only be tested by running it: asserting against a
 * reimplementation of the pattern would pass while the real rule matched
 * nothing. So each case writes a source file, runs Biome over it, and reads the
 * diagnostics back.
 *
 * The probe files go under src/ because Biome's file discovery is scoped to the
 * app's own tree — a file outside it is reported as "path ignored" and silently
 * produces zero findings, which is exactly the false green this test exists to
 * prevent. They are named per-case and removed in afterAll.
 *
 * Spec: specs/ci/semantic-color-tokens.feature
 */

const APP_ROOT = join(__dirname, "..", "..");
const PROBE_DIR = join(APP_ROOT, "src", "__probe__");

interface Diagnostic {
  category: string;
  description?: string;
  message?: unknown;
}

let probeCount = 0;

/** Run the plugin over `source` and return only its diagnostics. */
function lint(source: string): Diagnostic[] {
  mkdirSync(PROBE_DIR, { recursive: true });
  const name = `probe${probeCount++}.tsx`;
  const file = join(PROBE_DIR, name);
  writeFileSync(file, source, "utf8");

  let stdout = "";
  try {
    stdout = execFileSync(
      "pnpm",
      [
        "exec",
        "biome",
        "lint",
        "--only=plugin",
        "--max-diagnostics=none",
        "--reporter=json",
        `src/__probe__/${name}`,
      ],
      { cwd: APP_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (error) {
    // Biome exits non-zero precisely when it finds violations, which is the
    // case most of these tests are asserting. The payload is still on stdout.
    stdout = (error as { stdout?: string }).stdout ?? "";
  }

  const parsed = JSON.parse(stdout || '{"diagnostics":[]}') as {
    diagnostics: Diagnostic[];
  };
  return parsed.diagnostics.filter((d) => d.category === "plugin");
}

afterAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
});

describe("semantic-color-tokens plugin", () => {
  describe("given a raw palette shade in a color prop", () => {
    /** @scenario "A raw shade in a color prop is reported" */
    it("reports it, and names the token that carries the same light value", () => {
      const found = lint(`export const a = <Text color="gray.500" />;\n`);

      expect(found).toHaveLength(1);
      expect(JSON.stringify(found[0])).toContain("fg.subtle");
    });
  });

  describe("given a raw shade inside a brace expression", () => {
    /** @scenario "A raw shade inside an expression is reported" */
    it("reports it — a ternary hides the shade from a literal-only match", () => {
      const found = lint(
        `export const a = <Box bg={on ? "blue.500" : "transparent"} />;\n`,
      );

      expect(found).toHaveLength(1);
    });
  });

  describe("given a raw shade in a pseudo-state object", () => {
    /** @scenario "A raw shade in a pseudo-state object is reported" */
    it("reports it — _hover is an object, not a color prop", () => {
      const found = lint(
        `export const a = <Box _hover={{ bg: "gray.50" }} />;\n`,
      );

      expect(found).toHaveLength(1);
      expect(JSON.stringify(found[0])).toContain("bg.subtle");
    });
  });

  describe("given a per-mode object that still names a raw shade", () => {
    /** @scenario "A raw shade in a per-mode object is reported" */
    it("reports it, because the token already carries both modes", () => {
      const found = lint(
        `export const a = <Box borderColor={{ base: "gray.200", _dark: "border" }} />;\n`,
      );

      expect(found).toHaveLength(1);
    });
  });

  describe("given semantic tokens", () => {
    /** @scenario "A semantic token passes" */
    it("reports nothing", () => {
      const found = lint(
        `export const a = <Text color="fg.muted" bg="bg.panel" borderColor="border" />;\n`,
      );

      expect(found).toEqual([]);
    });
  });

  describe("given a raw shade that is not in a color prop", () => {
    /** @scenario "A value that is not a color prop passes" */
    it("reports nothing — the rule anchors on the prop, not on every string", () => {
      const found = lint(
        `export const cta = { legacyCtaColor: "orange.700" };\n`,
      );

      expect(found).toEqual([]);
    });
  });

  describe("given a deliberate fixed-color surface", () => {
    /** @scenario "A deliberate fixed-color surface opts out with a reason" */
    it("is silenced by a line-level suppression carrying its reason", () => {
      const found = lint(
        [
          "export const a = (",
          "  <Text",
          "    // biome-ignore lint/plugin: fixed-gradient hero",
          '    color="orange.700"',
          "  />",
          ");",
          "",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("given a file that defines or owns a palette", () => {
    /** @scenario "A file that defines or owns a palette opts out wholesale" */
    it("is silenced by a file-level suppression carrying its reason", () => {
      const found = lint(
        [
          "// biome-ignore-all lint/plugin: defines the palette",
          "",
          'export const a = <Text color="gray.500" />;',
          'export const b = <Text color="red.700" />;',
          "",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("given the rule's own fixtures file", () => {
    /** @scenario "The rule must still match its own fixtures" */
    it("still matches every deliberate violation in it", () => {
      const fixtures = join(
        APP_ROOT,
        "biome-plugins",
        "__tests__",
        "semantic-color-tokens.fixtures.tsx",
      );
      const found = lint(readFileSync(fixtures, "utf8"));

      // The floor, not the exact count: adding a violation to the fixtures
      // should not have to come back here and bump a number.
      expect(found.length).toBeGreaterThanOrEqual(11);
    });
  });
});
