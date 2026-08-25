import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { EMAIL_COLOR } from "../emailTheme";

/**
 * The tripwire on the one thing `emailTheme.ts` cannot enforce about itself.
 *
 * Its values are a hand transcription of the auth screens' light mode, because
 * a browser theme module cannot be imported into a server process and a mail
 * client cannot read a custom property. A transcription drifts silently: the
 * auth screens changes its orange, the mail keeps the old one, and nobody finds
 * out until two LangWatch surfaces are visibly different oranges.
 *
 * So this reads `authTheme.ts` as text and pulls the two values that
 * carry the identity — the ground everything stands on and the colour of the
 * primary action — straight out of the source it is transcribed from. Reading
 * the file rather than importing it is the point: importing would pull Chakra
 * into a server unit test, which is the coupling the transcription exists to
 * avoid.
 */

const authThemeSource = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../features/auth/authTheme.ts",
  ),
  "utf8",
);

/** `brand = { ..., 600: "#c2510a", ... }` */
const brandStop = (stop: number): string | undefined =>
  new RegExp(`\\b${stop}:\\s*"(#[0-9a-fA-F]{6})"`).exec(authThemeSource)?.[1];

describe("emailTheme", () => {
  describe("given the auth screens' own theme module", () => {
    it("reads the ground from the light half of the ground token", () => {
      const light = /ground:\s*mode\(\s*"(#[0-9a-fA-F]{6})"/.exec(
        authThemeSource,
      )?.[1];

      expect(light).toBeDefined();
      expect(EMAIL_COLOR.ground).toBe(light);
    });

    it("takes the action colour from the brand stop the auth screens names", () => {
      // The token is `action: mode(brand[600], ...)`, so the stop is read from
      // the token rather than assumed: a auth screens that moved its action to
      // another stop fails here rather than shipping a second orange.
      const stop = /action:\s*mode\(\s*brand\[(\d+)\]/.exec(
        authThemeSource,
      )?.[1];

      expect(stop).toBeDefined();
      expect(EMAIL_COLOR.action).toBe(brandStop(Number(stop)));
    });

    it("takes the tinted-surface text colour from the same ramp", () => {
      const stop = /ink:\s*mode\(\s*brand\[(\d+)\]/.exec(authThemeSource)?.[1];

      expect(stop).toBeDefined();
      expect(EMAIL_COLOR.accentText).toBe(brandStop(Number(stop)));
    });

    it("reads the tint from the light half of the tint token", () => {
      const light = /tint:\s*mode\(\s*"(#[0-9a-fA-F]{6})"/.exec(
        authThemeSource,
      )?.[1];

      expect(light).toBeDefined();
      expect(EMAIL_COLOR.tint).toBe(light);
    });
  });
});
