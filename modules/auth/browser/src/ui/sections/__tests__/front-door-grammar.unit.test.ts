import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The surface every door has in common, pinned in source: jsdom sees a compiled class name,
 * not a token or a radius. Each screen's behaviour is asserted by its own rendered test.
 * Spec: specs/identity/signin-signup-screens.feature
 */
const here = dirname(fileURLToPath(import.meta.url));

/** Read relative to the package `src` root, so a file can move between layers. */
const sourceOf = (path: string): string => readFileSync(join(here, "..", "..", "..", path), "utf8");

describe("given every door", () => {
  describe("when the primary action is drawn", () => {
    /** The gel came back twice because nothing said it could not; this says so. */
    /** @scenario "The primary action is a flat brand fill, not a gel button" */
    it("is a flat fill: no gradient, no inner highlight, no glow", () => {
      const rules = sourceOf("ui/elements/auth-front-door.css")
        .split(".lw-front-door-primary")
        .slice(1)
        .map((block) => block.slice(0, block.indexOf("}")))
        .join("\n");

      expect(rules).not.toContain("linear-gradient");
      expect(rules).not.toContain("inset");
      expect(rules).not.toContain("glow");
      // A hover that lifts the button is the material changing, not the colour.
      expect(rules).not.toMatch(/translateY\(-/);
    });

    /** @scenario "The primary action is a flat brand fill, not a gel button" */
    it("darkens one step along the brand ramp on hover and press, and rings in the brand", () => {
      const button = sourceOf("ui/elements/front-door-primary-button.tsx");

      expect(button).toContain('_hover: { backgroundColor: "frontDoor.actionHover" }');
      expect(button).toContain('_active: { backgroundColor: "frontDoor.actionHover" }');
      expect(button).toContain("{colors.frontDoor.focusRing}");
    });

    /** @scenario "The card has one radius language" */
    it("is cut to the same radius as the field above it", () => {
      const theme = sourceOf("model/front-door-theme.ts");

      const control = theme.match(/control:\s*"([^"]+)"/)?.[1];
      const field = theme.match(/field:\s*"([^"]+)"/)?.[1];
      expect(control).toBeTruthy();
      expect(control).toBe(field);
      expect(control).not.toBe("full");
      // No control on the card keeps a pill while its neighbours do not.
      expect(theme).not.toMatch(/:\s*"full"/);
    });

    /** @scenario "The card has one radius language" */
    it("is the same button on every door, from one definition", () => {
      for (const file of [
        "ui/sections/forgot-password-screen.tsx",
        "ui/sections/reset-password-screen.tsx",
        "ui/sections/sign-in-error-screen.tsx",
        "ui/sections/sign-up-credential-form.tsx",
        "ui/sections/invite-landing.tsx",
        "ui/sections/two-step-challenge-panel.tsx",
      ]) {
        const source = sourceOf(file);
        expect(source, file).toMatch(/FrontDoorPrimaryButton|FRONT_DOOR_PRIMARY_STYLE/);
        // None of them restates the fill, or reaches for the app's own orange ramp.
        expect(source, file).not.toContain('backgroundColor="frontDoor.action"');
        expect(source, file).not.toContain('colorPalette="orange"');
      }
    });
  });

  describe("when a stage is in flight", () => {
    /** @scenario "A stage in flight says so in place" */
    it("keeps the button's label beside its spinner, and stops taking presses", () => {
      const button = sourceOf("ui/elements/front-door-primary-button.tsx");

      // The default swaps the label for a bare spinner, so the one word saying what was set in
      // motion disappears exactly when somebody wants to check it.
      expect(button).toContain("loadingText={children}");
      expect(button).toContain("loading={isBusy}");
      expect(button).toContain("disabled={isDisabled}");
    });

    /** @scenario "A stage in flight says so in place" */
    it("locks the field whose answer is being waited on", () => {
      for (const file of [
        "ui/sections/identifier-step-form.tsx",
        "ui/sections/two-step-challenge-panel.tsx",
      ]) {
        expect(sourceOf(file), file).toMatch(/disabled=\{is(Submitting|Busy)\}/);
      }
    });
  });

  describe("when somebody is on the wrong door", () => {
    /** @scenario "Every stage offers the other door" */
    it("offers the other one from every stage that can be arrived at cold", () => {
      const signIn = sourceOf("ui/sections/identifier-first-sign-in.tsx");
      const signUp = sourceOf("ui/sections/verification-first-sign-up.tsx");

      expect([...signIn.matchAll(/<SignUpLink/g)].length).toBeGreaterThan(2);
      expect([...signUp.matchAll(/<LogInLink/g)].length).toBeGreaterThan(1);
    });

    /** @scenario "Every stage offers the other door" */
    it("carries the address across", () => {
      // The href itself, in the fragment the browser does not send, is asserted by
      // carried-email.unit.test.ts; this pins that the sign-in door hands the address over.
      expect(sourceOf("ui/sections/identifier-first-sign-in.tsx")).toContain("email={email}");
    });
  });
});
