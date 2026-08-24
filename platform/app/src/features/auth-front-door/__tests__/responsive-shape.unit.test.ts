import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The responsive contract of the front door, pinned where it is written.
 *
 * A rendered assertion cannot see this: Chakra compiles responsive props to
 * class names, so a jsdom render shows `class="chakra-input css-ee9xfg"` for
 * both a field that is 16px on a phone and one that is not. What CAN be
 * checked is that the props are still there — which is the thing that gets
 * quietly dropped in a refactor, and the thing an iPhone notices immediately
 * by zooming the page in on focus and never zooming back out.
 */
const here = dirname(fileURLToPath(import.meta.url));

const sourceOf = (path: string): string =>
  readFileSync(join(here, "..", path), "utf8");

const authCard = readFileSync(
  join(here, "..", "..", "..", "components", "auth", "AuthCard.tsx"),
  "utf8",
);

describe("given the front door on a small viewport", () => {
  describe("when the card is laid out", () => {
    it("goes full bleed on a phone and stays a narrow column above it", () => {
      expect(authCard).toContain('maxW={{ base: "100%", sm: "440px" }}');
      expect(authCard).toContain('borderWidth={{ base: 0, sm: "1px" }}');
      expect(authCard).toContain('borderRadius={{ base: 0, sm: "14px" }}');
      // Nothing may be pinned wider than the narrowest phone this has to work
      // on: a fixed pixel width is what produces a page that scrolls sideways.
      expect(authCard).not.toMatch(/width="\d{3,}px"/);
    });
  });

  describe("when a field takes focus", () => {
    it("asks for at least 16px, and a target big enough to hit", () => {
      for (const file of [
        "components/IdentifierStepForm.tsx",
        "components/CredentialSignInForm.tsx",
        "components/SignUpCredentialForm.tsx",
      ]) {
        const source = sourceOf(file);
        expect(source).toContain('fontSize={{ base: "16px", md: "sm" }}');
        expect(source).toContain('minHeight="44px"');
      }
    });
  });

  describe("when the primary action is rendered", () => {
    it("spans the column, so it is reachable with a thumb", () => {
      for (const file of [
        "components/IdentifierStepForm.tsx",
        "components/CredentialSignInForm.tsx",
        "components/SignUpCredentialForm.tsx",
      ]) {
        expect(sourceOf(file)).toMatch(
          /width="full"[\s\S]{0,120}minHeight="44px"/,
        );
      }
    });
  });
});

describe("given the front door in either colour mode", () => {
  describe("when a component states a colour", () => {
    it("names a property or a token, never a light-only value", () => {
      for (const file of [
        "components/IdentifierStepForm.tsx",
        "components/CredentialSignInForm.tsx",
        "components/SignUpCredentialForm.tsx",
        "components/SignInMethodPicker.tsx",
        "components/FrontDoorShell.tsx",
        "components/FrontDoorValuePanel.tsx",
      ]) {
        // A hex literal in a component is a value that cannot follow the mode
        // toggle. The brand values live in `logic/brand.ts` as custom
        // properties, declared for both modes in the stylesheet.
        expect(sourceOf(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      }
    });

    it("declares both modes where the brand values are written down", () => {
      const styles = sourceOf("authFrontDoor.css");
      expect(styles).toContain("--lw-front-door-action:");
      expect(styles).toMatch(/\.dark\s*\{/);
    });

    it("gives the refusal red and the accent details a dark step of their own", () => {
      const styles = sourceOf("authFrontDoor.css");
      const [light = "", dark = ""] = styles.split(/\.dark\s*\{/);

      for (const property of [
        "--lw-front-door-danger:",
        "--lw-front-door-detail:",
      ]) {
        expect(light).toContain(property);
        expect(dark).toContain(property);
        // The two modes must not agree: a red that reads on white is the red
        // that fails on a dark ground, which is the whole reason for the pair.
        const lightValue = light.split(property)[1]?.split(";")[0]?.trim();
        const darkValue = dark.split(property)[1]?.split(";")[0]?.trim();
        expect(lightValue).toBeTruthy();
        expect(darkValue).not.toBe(lightValue);
      }
    });
  });
});

describe("given the hosted panel on a narrow viewport", () => {
  describe("when the split has nowhere to go", () => {
    it("keeps the headline and stands the rest down", () => {
      const panel = sourceOf("components/FrontDoorValuePanel.tsx");

      // Both the tagline and the trusted-by row are desktop-only: stacked
      // above a log-in form on a phone they are two screens of scrolling in
      // front of the thing the person came to do.
      expect([
        ...panel.matchAll(/display=\{\{ base: "none", md: "block" \}\}/g),
      ]).toHaveLength(2);
      expect(panel).toContain('width={{ base: "full", md: "50%" }}');
      expect(panel).toContain('borderInlineEndWidth={{ base: 0, md: "1px" }}');
    });
  });
});

describe("given somebody who has asked for less motion", () => {
  describe("when the front door animates anything", () => {
    it("declares every animation inside a no-preference query", () => {
      const styles = sourceOf("authFrontDoor.css");
      const animations = [...styles.matchAll(/animation:/g)].length;
      const guarded = [
        ...styles.matchAll(/@media \(prefers-reduced-motion: no-preference\)/g),
      ].length;

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
