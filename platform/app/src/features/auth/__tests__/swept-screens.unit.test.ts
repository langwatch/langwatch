import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The screens swept onto the auth screens' grammar, pinned where the grammar is
 * written down.
 *
 * These are source assertions on purpose, and the reason is the same one
 * `responsive-shape.unit.test.ts` gives: Chakra compiles a token to a class
 * name, so a jsdom render shows `css-1y7465a` for a card standing on the front
 * door's ground and for one standing on the app's grey. What CAN be checked is
 * that the screen still composes the shell, still publishes a stage, and still
 * names a token rather than a colour — which is exactly what a refactor drops
 * quietly, and exactly what a person notices the moment they cross from one of
 * these screens to another.
 *
 * What the behaviour of each screen does is asserted by its own rendered test;
 * this file only holds the surface they must have in common.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoFile = (...parts: string[]): string =>
  readFileSync(join(here, "..", "..", "..", ...parts), "utf8");

/**
 * The file with its comments taken out.
 *
 * Only the colour assertion uses this, and it needs it: these files cite pull
 * requests in prose, and `#5984` matches every hex-literal pattern anybody
 * would write. A comment cannot paint anything, so a rule about colours has no
 * business reading one — and a naive match would have the test failing on the
 * next person who explains a decision by naming the change that made it.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every screen a signed-out or mid-ceremony person can reach. */
const SWEPT_SCREENS: readonly string[] = [
  "pages/auth/signin.tsx",
  "pages/auth/signup.tsx",
  "pages/auth/forgot-password.tsx",
  "pages/auth/reset-password.tsx",
  "pages/auth/verify-email.tsx",
  "pages/auth/error.tsx",
  "pages/auth/join.tsx",
  "pages/invite/accept.tsx",
];

/**
 * The screens that still carry their pre-flip twin: none, now.
 *
 * It held sign-in, sign-up and accept while `IDENTITY_ROUTER_V2` was live and
 * rollback was the flag off, because until the bake ended those files held
 * BOTH doors and the legacy half was the app's own furniture on purpose. The
 * strict assertions below were scoped away from them for exactly that long.
 *
 * The bake ended, the flag and the legacy halves are deleted, and the list is
 * empty — which is what its own instruction said to do, and what tightens the
 * assertions onto the three screens they most needed to cover. Left populated
 * it would go on excusing the very files the flip rewrote.
 *
 * Keep it empty. A screen that needs excusing from these rules is a screen
 * that has left the auth surface without saying so.
 */
const STILL_CARRY_A_LEGACY_TWIN: readonly string[] = [];

/** The cards those screens draw, including the ones swept in this pass. */
const SWEPT_CARDS: readonly string[] = [
  "features/auth/components/InviteLanding.tsx",
  "features/auth/components/JoinBeforeCreateInterstitial.tsx",
  "features/auth/components/TwoStepChallengePanel.tsx",
  "features/auth/components/AuthPrimaryButton.tsx",
];

describe("given every unauthenticated screen", () => {
  describe("when one of them draws itself", () => {
    /** @scenario The sign-in error screen is the same card as the door it came from */
    /** @scenario The invitation and join screens stand on the same ground */
    it("stands on the auth screens' ground rather than the app's own furniture", () => {
      for (const screen of SWEPT_SCREENS) {
        const source = repoFile(screen);
        expect(source, screen).toContain("AuthShell");
        if (STILL_CARRY_A_LEGACY_TWIN.includes(screen)) continue;
        // The setup layout is the app's grey panel with a sign-out button
        // pinned to the corner. It is what these screens were, and a screen
        // that goes back to it has left the auth screens without saying so.
        expect(source, screen).not.toContain("SetupLayout");
      }
    });

    /** @scenario The invitation and join screens stand on the same ground */
    it("tells the ground where it is, so the field moves with the card", () => {
      // The morph is what makes a sequence of cards read as one conversation
      // rather than as a series of pages. A screen that draws a card and
      // publishes nothing leaves the ground on whatever the last screen said.
      for (const screen of [
        "pages/auth/verify-email.tsx",
        "pages/auth/error.tsx",
        "pages/auth/join.tsx",
        "pages/invite/accept.tsx",
        "features/auth/components/InviteLanding.tsx",
      ]) {
        expect(repoFile(screen), screen).toContain("usePublishAuthStage");
      }
    });

    /** @scenario The sign-in error screen is the same card as the door it came from */
    it("names a token for every colour, never a value and never the app's ramp", () => {
      const enforcedOnly = [...SWEPT_SCREENS, ...SWEPT_CARDS].filter(
        (file) => !STILL_CARRY_A_LEGACY_TWIN.includes(file),
      );

      for (const file of enforcedOnly) {
        const source = withoutComments(repoFile(file));
        // A hex is a value that cannot follow the colour-mode toggle.
        expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        // `colorPalette="orange"` is the APP's orange ramp, which is a
        // different cut from the auth screens'. Two oranges on one journey
        // reads as two products.
        expect(source, file).not.toContain('colorPalette="orange"');
        expect(source, file).not.toContain('color="orange.500"');
      }
    });
  });

  describe("when the primary action is drawn", () => {
    /**
     * The gel has been removed twice now — a 22% sheen over a backdrop blur,
     * then a "whisper of top light" that was still a 14% gradient with a 20%
     * inner highlight — and it came back both times because nothing said it
     * could not. This says so.
     */
    /** @scenario The primary action is a flat brand fill, not a gel button */
    it("is a flat fill: no gradient, no inner highlight, no glow", () => {
      const styles = repoFile("features/auth/auth.css");
      const rules = styles
        .split(".lw-auth-primary")
        .slice(1)
        .map((block) => block.slice(0, block.indexOf("}")))
        .join("\n");

      expect(rules).not.toContain("linear-gradient");
      // A white inset along the top edge is the bevel. Any inset at all on
      // this button is one.
      expect(rules).not.toContain("inset");
      expect(rules).not.toContain("glow");
      // And it must not GROW when pointed at: a hover that changes the shadow
      // or lifts the button is the material changing, which is the same
      // mistake wearing a different name.
      expect(rules).not.toMatch(/translateY\(-/);
    });

    /** @scenario The card has one radius language */
    it("is cut to the same radius as the field above it", () => {
      const theme = repoFile("features/auth/authTheme.ts");

      // One radius language on the card: a 10px input under a fully-rounded
      // pill is two shape vocabularies arguing on one surface.
      const control = theme.match(/control:\s*"([^"]+)"/)?.[1];
      const field = theme.match(/field:\s*"([^"]+)"/)?.[1];
      expect(control).toBeTruthy();
      expect(control).toBe(field);
      expect(control).not.toBe("full");
    });

    /** @scenario The card has one radius language */
    it("is the same button on every door, from one definition", () => {
      // Six screens used to hand-copy these eleven props, which is how they
      // came to disagree. Anything on the auth card that draws the primary
      // either renders the component or spreads its style object.
      for (const file of [
        "pages/auth/forgot-password.tsx",
        "pages/auth/reset-password.tsx",
        "pages/auth/error.tsx",
        "features/auth/components/SignUpCredentialForm.tsx",
        "features/auth/components/JoinBeforeCreateInterstitial.tsx",
        "features/auth/components/InviteLanding.tsx",
        "features/auth/components/TwoStepChallengePanel.tsx",
      ]) {
        const source = repoFile(file);
        expect(source, file).toMatch(/AuthPrimaryButton|AUTH_PRIMARY_STYLE/);
        // None of them re-states the fill by hand any more.
        expect(source, file).not.toContain('backgroundColor="auth.action"');
      }
    });
  });

  describe("when a stage is in flight", () => {
    /** @scenario A stage in flight says so in place */
    it("keeps the button's label beside its spinner, and stops taking presses", () => {
      const button = repoFile("features/auth/components/AuthPrimaryButton.tsx");

      // Chakra's default swaps the label for a bare spinner: the content
      // changes width, the row re-centres, and the one word telling somebody
      // what they set in motion disappears exactly when they want to check it.
      expect(button).toContain("loadingText={children}");
      expect(button).toContain("loading={isBusy}");
      // A submit that can be pressed twice is a verification email sent twice,
      // or two attempts racing for one rate-limit budget.
      expect(button).toContain("disabled={isDisabled}");
    });

    /** @scenario A stage in flight says so in place */
    it("locks the field whose answer is being waited on", () => {
      // The address decides which screen comes next, and a code spends one of
      // a small budget of attempts. Editing either mid-flight lands somebody
      // on the answer to a question they stopped asking.
      for (const file of [
        "features/auth/components/IdentifierStepForm.tsx",
        "features/auth/components/TwoStepChallengePanel.tsx",
      ]) {
        expect(repoFile(file), file).toMatch(
          /disabled=\{is(Submitting|Busy)\}/,
        );
      }
    });
  });

  describe("when somebody is on the wrong door", () => {
    /** @scenario Every stage offers the other door */
    it("offers the other one from every stage that can be arrived at cold", () => {
      const signIn = repoFile(
        "features/auth/components/IdentifierFirstSignIn.tsx",
      );
      const signUp = repoFile(
        "features/auth/components/VerificationFirstSignUp.tsx",
      );

      // Both directions, and more than once on each: the address step, the
      // method step, and the two cards somebody can land on cold — a hand-off
      // that is taking too long, and a confirmation link that has expired.
      expect([...signIn.matchAll(/<SignUpLink/g)].length).toBeGreaterThan(2);
      expect([...signUp.matchAll(/<LogInLink/g)].length).toBeGreaterThan(1);
    });

    /** @scenario Every stage offers the other door */
    it("carries the address across, in the fragment the browser does not send", () => {
      // The FRAGMENT rather than the query, because it reaches no access log
      // and no `Referer` header on the way to the other door.
      //
      // Asserted where the behaviour is: `carriedEmail.unit.test.ts` builds
      // the href and compares the whole string. A `toContain("#")` over this
      // module's source matched any hash anywhere in it — a private field, a
      // colour, a comment citing a PR — so it would have gone on passing had
      // the builder been rewritten to emit `?email=`.
      expect(
        repoFile("features/auth/components/IdentifierFirstSignIn.tsx"),
      ).toContain("email={email}");
    });
  });
});
