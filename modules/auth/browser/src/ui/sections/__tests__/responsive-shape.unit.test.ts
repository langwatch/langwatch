import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDesignSystem } from "@langwatch/design-system/system";
import { describe, expect, it } from "vitest";

/** Pins responsive prop contract to source; jsdom cannot see compiled Chakra props. */
const here = dirname(fileURLToPath(import.meta.url));

/** Read relative to the package `src` root, so a file can move between layers. */
const sourceOf = (path: string): string => readFileSync(join(here, "..", "..", "..", path), "utf8");

describe("given the front door on a small viewport", () => {
  describe("when a field takes focus", () => {
    /**
     * Every file that renders an INPUT — now two, since the password boxes
     * moved into `PasswordInput`. Asserting on forms that merely compose it
     * would pass while checking nothing.
     */
    it("asks for at least 16px, and a target big enough to hit", () => {
      // The design system's `md` step is the 16px that keeps a phone from zooming.
      expect(createDesignSystem().token("fontSizes.md")).toBe("1rem");
      for (const file of [
        "ui/sections/identifier-step-form.tsx",
        "ui/elements/password-input.tsx",
      ]) {
        const source = sourceOf(file);
        expect(source).toContain('fontSize={{ base: "md", md: "sm" }}');
        expect(source).toContain('minHeight="44px"');
      }
    });
  });

  describe("when the primary action is rendered", () => {
    it("spans the column, so it is reachable with a thumb", () => {
      const button = sourceOf("ui/elements/front-door-primary-button.tsx");

      expect(button).toMatch(/width:\s*"full"[\s\S]{0,200}minHeight:\s*"44px"/);
    });

    /** A form that gave its button up must render the shared one, or the check above is empty. */
    it("is the shared button wherever a screen gave its own up", () => {
      for (const file of [
        "ui/sections/identifier-step-form.tsx",
        "ui/sections/credential-sign-in-form.tsx",
        "ui/sections/sign-up-credential-form.tsx",
        "ui/sections/two-step-challenge-panel.tsx",
      ]) {
        expect(sourceOf(file), file).toContain("<FrontDoorPrimaryButton");
      }
    });
  });
});

describe("given the front door in either colour mode", () => {
  describe("when a component states a colour", () => {
    it("names a property or a token, never a light-only value", () => {
      for (const file of [
        "ui/sections/identifier-step-form.tsx",
        "ui/sections/credential-sign-in-form.tsx",
        "ui/sections/sign-up-credential-form.tsx",
        "ui/sections/sign-in-method-picker.tsx",
        "ui/sections/front-door-shell.tsx",
        "ui/elements/front-door-value-panel.tsx",
      ]) {
        // A hex literal in a component is a value that cannot follow the mode
        // toggle. The brand values are semantic tokens in `frontDoorTheme.ts`,
        // which declares each one for both grounds.
        expect(sourceOf(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      }
    });

    /**
     * The front door inherits the product palette: each token names a product
     * role, and the product role carries the pair for both grounds. A literal
     * here would be one ground's value pinned to both.
     */
    it("declares every brand value as a product role, which carries both grounds", () => {
      const theme = sourceOf("model/front-door-theme.ts");

      expect(theme).toContain("semanticTokens");
      expect(theme).toContain("frontDoor:");
      const values = [...theme.matchAll(/^\s+\w+: \{ value: "([^"]+)" \}/gm)].map(
        ([, value]) => value,
      );
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(value).toMatch(/\{colors\.[\w.]+\}/);
    });

    it("gives the refusal red and the accent details the product's own roles", () => {
      const theme = sourceOf("model/front-door-theme.ts");

      expect(theme).toContain('danger: { value: "{colors.fg.error}" }');
      expect(theme).toContain('detail: { value: "{colors.orange.fg}" }');
    });

    /** Colour lives in the theme: the stylesheet re-declares none of its variables. */
    it("leaves the theme's emitted colour variables to the theme", () => {
      const styles = sourceOf("ui/elements/auth-front-door.css");

      expect(styles).toContain("var(--chakra-colors-front-door-detail)");
      expect(styles).not.toMatch(/--chakra-colors-front-door-[\w-]+\s*:/);
    });
  });
});

describe("given the hosted panel on a narrow viewport", () => {
  describe("when the split has nowhere to go", () => {
    it("keeps the headline and stands the rest down", () => {
      const panel = sourceOf("ui/elements/front-door-value-panel.tsx");

      // Both the tagline and the trusted-by row are desktop-only: stacked
      // above a log-in form on a phone they are two screens of scrolling in
      // front of the thing the person came to do.
      expect([...panel.matchAll(/display=\{\{ base: "none", md: "block" \}\}/g)]).toHaveLength(2);
      expect(panel).toContain('width={{ base: "full", md: "56%" }}');
    });
  });
});

describe("given somebody who has asked for less motion", () => {
  describe("when the front door animates anything", () => {
    it("declares every animation inside a no-preference query", () => {
      const styles = sourceOf("ui/elements/auth-front-door.css");
      const animations = [...styles.matchAll(/animation:/g)].length;
      const guarded = [...styles.matchAll(/@media \(prefers-reduced-motion: no-preference\)/g)]
        .length;

      expect(animations).toBeGreaterThan(0);
      expect(guarded).toBeGreaterThan(0);
      // Every animation sits inside a guarded block: the file opens no
      // animation outside one.
      for (const block of styles
        .split("@media (prefers-reduced-motion: no-preference)")[0]!
        .split("}")) {
        expect(block).not.toContain("animation:");
      }
    });
  });
});
