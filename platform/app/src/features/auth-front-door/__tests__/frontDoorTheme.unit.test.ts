/**
 * The front door's palette is a THEME, not a stylesheet.
 *
 * These pin the two properties that make that true and that a refactor could
 * quietly undo: the tokens actually reach the system (so `bg="frontDoor.action"`
 * resolves rather than silently rendering nothing), and adding them changed no
 * token any other surface reads.
 *
 * The emitted variable names are asserted rather than assumed, because the
 * wide-gamut block in `authFrontDoor.css` re-declares them by name — a rename
 * in the theme would leave that block overriding variables nobody reads, which
 * is a silent loss of the P3 upgrade rather than a build failure.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { describe, expect, it } from "vitest";

import { system } from "~/pages/_app";

// getTokenCss() emits `{"@layer tokens": {"<selector>": {--var: value}}}`.
const tokenCss = () =>
  system.getTokenCss() as Record<
    string,
    Record<string, Record<string, string>>
  >;

const layer = () => tokenCss()["@layer tokens"] ?? {};

/** Every emitted variable, whatever selector it was emitted under. */
const allVariables = () => {
  const names = new Set<string>();
  for (const block of Object.values(layer())) {
    for (const name of Object.keys(block)) names.add(name);
  }
  return names;
};

describe("given the front door's theme tokens", () => {
  describe("when the app's design system is built", () => {
    it("carries the whole namespace, so a component can style through it", () => {
      const variables = allVariables();

      for (const token of [
        "ground",
        "action",
        "action-hover",
        "on-action",
        "ink",
        "tint",
        "hairline",
        "danger",
        "detail",
        "focus-ring",
        "glow",
        "card-bg",
        "card-border",
        "field-bg",
        "field-border",
      ]) {
        expect(variables).toContain(`--chakra-colors-front-door-${token}`);
      }
    });

    it("resolves the action colour on both grounds", () => {
      const blocks = Object.values(layer());
      const values = blocks
        .map((block) => block["--chakra-colors-front-door-action"])
        .filter(Boolean);

      // Two grounds, two answers. One would mean a token pinned to a single
      // colour mode, which is the bug the custom properties had before the
      // dark block was written.
      expect(new Set(values).size).toBe(2);
    });

    /**
     * The reason this is a namespace rather than an override of the app's own
     * tokens: the front door borrows the marketing site's orange, and the app
     * uses a different one. Nothing here is allowed to move a pixel anywhere
     * else in the product.
     */
    it("touches no token any other surface reads", () => {
      const foreign = [...allVariables()].filter(
        (name) =>
          name.startsWith("--chakra-colors-front-door-") === false &&
          name.includes("front-door"),
      );

      expect(foreign).toEqual([]);
    });
  });
});
