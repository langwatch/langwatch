import { semanticTokens, toastSlotRecipe } from "@chakra-ui/react/theme";
import { describe, expect, it } from "vitest";
import { LIGHT_MODE_ELEVATION, SYMMETRIC_PADDING_END } from "../toaster";

/**
 * #6716: the toast card read as off-centre and didn't read as a toast at
 * all, worst in light mode — a regression from the error-handling redesign
 * pass. Two root causes, regression-guarded here against Chakra's ACTUAL
 * shipped recipe/tokens (imported from `@chakra-ui/react/theme`, the
 * package's public subpath export) rather than a hardcoded copy — so a
 * future Chakra upgrade that changes either value fails this test instead
 * of silently drifting out from under the fix.
 *
 *  - Chakra's base toast recipe pads `pe: "6"` against `ps: "4"` to leave
 *    room for an ABSOLUTELY positioned close button. This app's close
 *    trigger is `position="static"` (a real flex sibling), so that extra
 *    end padding was dead space with nothing in it — the content read as
 *    shifted toward the start. See `toaster.layout.integration.test.tsx`
 *    for proof this override actually reaches the rendered DOM.
 *  - The `lg` shadow token is ~10% opacity in light mode (vs 64% in dark),
 *    tuned for a panel that's expected to sit there, not a card that has to
 *    separate itself from the page in the half-second before anyone looks.
 */
// Chakra types every recipe layer as optional; the guard keeps the
// assertions honest — a Chakra upgrade that drops the layer fails loudly
// here instead of comparing against undefined.
const toastRootRecipe = toastSlotRecipe.base?.root;
if (!toastRootRecipe) {
  throw new Error("Chakra's toast slot recipe no longer carries base.root");
}

describe("given the toast card's material", () => {
  describe("when there is no close button to reserve space for", () => {
    it("pads symmetrically, matching the recipe's own start padding, not its end padding", () => {
      // The override must equal the recipe's `ps` (what a close-button-free
      // toast should look like) and must NOT equal the recipe's own `pe` —
      // otherwise this "fix" would just be re-asserting the broken default.
      expect(SYMMETRIC_PADDING_END).toBe(toastRootRecipe.ps);
      expect(SYMMETRIC_PADDING_END).not.toBe(toastRootRecipe.pe);
    });
  });

  describe("when the toast renders in light mode", () => {
    it("uses a stronger elevation than the recipe's own light-mode 'lg' shadow", () => {
      const recipeLightShadow = semanticTokens.shadows.lg.value._light;
      // Pull the gray-900 alpha percentage out of each shadow layer, in
      // order (blur first, 1px ring second — both values have exactly two
      // layers). The real, currently-shipped token spells it
      // `{colors.gray.900/N}`; this file's override spells the equivalent
      // `color-mix(... gray-900) N%`, so match either. A plain `split(",")`
      // would fragment `color-mix(in srgb, …, transparent)`'s own internal
      // commas, so match globally across the whole string instead. Requires
      // BOTH layers (the blur spread and the ring) to be more opaque than
      // the real token's own layers — a numeric comparison against Chakra's
      // live value, not a restated literal.
      const alphasOf = (shadow: string) =>
        [...shadow.matchAll(/gray[.-]900\)?[\s/](\d+)%?/g)].map((m) =>
          Number(m[1]),
        );
      const [recipeBlur, recipeRing] = alphasOf(recipeLightShadow);
      const [overrideBlur, overrideRing] = alphasOf(LIGHT_MODE_ELEVATION);

      expect(recipeBlur).toBeDefined();
      expect(overrideBlur).toBeGreaterThan(recipeBlur!);
      expect(recipeRing).toBeDefined();
      expect(overrideRing).toBeGreaterThan(recipeRing!);
    });
  });
});
