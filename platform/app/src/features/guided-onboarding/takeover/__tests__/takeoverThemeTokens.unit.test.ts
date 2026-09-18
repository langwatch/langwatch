/**
 * Every brand colour the guided takeover and the sign-in screens name must
 * exist in the auth theme.
 *
 * Chakra accepts any string as a colour: a token name that no longer exists
 * is passed through as a raw CSS value, the browser drops it, and the element
 * renders with no fill at all. Typecheck and the component tests stay green,
 * which is how the value cards' pick order lost its orange square when the
 * theme namespace was renamed. This walks the source for the names in use and
 * checks each one against the theme itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSystem, defaultConfig } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";
import { authThemeConfig } from "~/features/auth/authTheme";

const featuresDir = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The folders whose screens render with the auth theme's colours. */
const THEMED_DIRS = [
  join(featuresDir, "guided-onboarding"),
  join(featuresDir, "auth", "components"),
];

/** Quoted `namespace.name` literals that are file names, not colours. */
const FILE_EXTENSIONS = new Set(["css", "ts", "tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function namedColours(namespace: string): Map<string, string[]> {
  const pattern = new RegExp(`["'\`]${namespace}\\.([a-zA-Z]+)["'\`]`, "g");
  const uses = new Map<string, string[]>();
  for (const file of THEMED_DIRS.flatMap(sourceFiles)) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      const name = match[1]!;
      if (FILE_EXTENSIONS.has(name)) continue;
      uses.set(name, [
        ...(uses.get(name) ?? []),
        file.slice(featuresDir.length + 1),
      ]);
    }
  }
  return uses;
}

const authColours = Object.keys(
  authThemeConfig.theme?.semanticTokens?.colors?.auth ?? {},
);

describe("the takeover and sign-in screens' brand colours", () => {
  describe("when a screen names an auth colour", () => {
    /** @scenario The pick order reads as white on a filled brand orange square */
    it("names one the auth theme defines", () => {
      const missing = [...namedColours("auth")].filter(
        ([name]) => !authColours.includes(name),
      );
      expect(missing).toEqual([]);
    });

    it("finds the colours in use, so an empty scan cannot pass", () => {
      expect([...namedColours("auth").keys()]).toEqual(
        expect.arrayContaining(["badge", "action", "detail"]),
      );
    });
  });

  describe("when a value card is picked", () => {
    it("fills its order square with the deepened brand orange in both modes", () => {
      const system = createSystem(defaultConfig, authThemeConfig);
      const tokenCss = JSON.stringify(system.getTokenCss());
      expect(system.token("colors.auth.badge")).toBe(
        "var(--chakra-colors-auth-badge)",
      );
      expect(tokenCss).toContain('"--chakra-colors-auth-badge":"#c2510a"');
      expect(tokenCss).not.toMatch(/"--chakra-colors-auth-badge":"rgba\(/);
    });
  });

  describe("when the theme namespace has been renamed", () => {
    it("leaves no colour under the old frontDoor name", () => {
      expect([...namedColours("frontDoor")]).toEqual([]);
    });
  });
});
