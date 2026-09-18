/**
 * Front door palette is a theme not stylesheet; tokens reach system and don't change other surfaces
 */
import { describe, expect, it } from "vitest";

import { createDesignSystem } from "@langwatch/design-system/system";

import { frontDoorThemeConfig } from "../front-door-theme.ts";

/**
 * System built here rather than imported; package can't import application it installs into
 */
const system = createDesignSystem(frontDoorThemeConfig);

// getTokenCss() emits `{"@layer tokens": {"<selector>": {--var: value}}}`.
const tokenCss = () =>
  system.getTokenCss() as Record<string, Record<string, Record<string, string>>>;

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
     * Why this is a namespace, not an override of the app's own tokens: the
     * front door borrows the marketing site's orange, the app uses a
     * different one — nothing here may move a pixel elsewhere in the product.
     */
    it("touches no token any other surface reads", () => {
      const foreign = [...allVariables()].filter(
        (name) =>
          name.startsWith("--chakra-colors-front-door-") === false && name.includes("front-door"),
      );

      expect(foreign).toEqual([]);
    });
  });
});
