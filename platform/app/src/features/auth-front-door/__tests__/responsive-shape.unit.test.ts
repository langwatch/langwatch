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
      expect(authCard).toContain('maxW={{ base: "100%", sm: "408px" }}');
      expect(authCard).toContain('borderWidth={{ base: 0, sm: "1px" }}');
      expect(authCard).toContain('borderRadius={{ base: 0, sm: "14px" }}');
      // Nothing may be pinned wider than the narrowest phone this has to work
      // on: a fixed pixel width is what produces a page that scrolls sideways.
      expect(authCard).not.toMatch(/width="\d{3,}px"/);
    });
  });

  describe("when a field takes focus", () => {
    /**
     * Every file that renders an INPUT, which is now two: the password boxes
     * moved into `PasswordInput` when the reveal toggle went inside them, so
     * asserting this on the forms that merely compose it would pass while
     * checking nothing.
     */
    it("asks for at least 16px, and a target big enough to hit", () => {
      for (const file of [
        "components/IdentifierStepForm.tsx",
        "components/PasswordInput.tsx",
      ]) {
        const source = sourceOf(file);
        expect(source).toContain('fontSize={{ base: "16px", md: "14px" }}');
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
        // toggle. The brand values are semantic tokens in `frontDoorTheme.ts`,
        // which declares each one for both grounds.
        expect(sourceOf(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      }
    });

    /**
     * The colours moved out of the stylesheet and into the theme, which is
     * what lets a component write `bg="frontDoor.action"`. These two used to
     * read the CSS; they read the token source now, because that is where the
     * pair is declared.
     */
    it("declares both grounds where the brand values are written down", () => {
      const theme = sourceOf("frontDoorTheme.ts");

      expect(theme).toContain("semanticTokens");
      expect(theme).toContain("frontDoor:");
      // The helper every token goes through. A token written as a bare string
      // would be one ground's value pinned to both.
      expect(theme).toMatch(/_light:[\s\S]{0,40}_dark:/);
    });

    it("gives the refusal red and the accent details a dark step of their own", () => {
      const theme = sourceOf("frontDoorTheme.ts");

      for (const token of ["danger", "detail"]) {
        const declaration = theme
          .split(new RegExp(`\\b${token}: mode\\(`))[1]
          ?.split(")")[0];
        expect(declaration).toBeTruthy();

        // The two grounds must not agree: a red that reads on white is the red
        // that fails on a dark ground, which is the whole reason for the pair.
        const [light, dark] = (declaration ?? "")
          .split(",")
          .map((part) => part.trim());
        expect(light).toBeTruthy();
        expect(dark).toBeTruthy();
        expect(dark).not.toBe(light);
      }
    });

    /**
     * The wide-gamut block upgrades the theme's OWN emitted variables. A
     * rename in the theme would leave it overriding variables nobody reads —
     * no build error, just a silent loss of the P3 colours — so the two are
     * pinned to each other here.
     */
    it("upgrades the same variables the theme emits, on a display that can show them", () => {
      const styles = sourceOf("authFrontDoor.css");

      expect(styles).toContain("@media (color-gamut: p3)");
      expect(styles).toContain("--chakra-colors-front-door-action:");
      expect(styles).toContain("color(display-p3");
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
