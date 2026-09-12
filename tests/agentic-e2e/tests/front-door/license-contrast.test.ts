/**
 * Bug-bash finding #10: the "Activate a license" button is readable in light
 * mode.
 *
 * Not bound to a scenario in any of the four specs this pass otherwise binds
 * against (`signin-signup-screens.feature`, `passkeys.feature`,
 * `password-reset.feature`, `identifier-model.feature`) — this button lives
 * in `/settings/security`'s `EnterpriseCapabilitiesSection`, outside the
 * front door proper, so no `@scenario` annotation is added here and this
 * file carries no `check-feature-parity` obligation.
 *
 * A computed-style WCAG contrast check is the honest version of this finding:
 * the fix already landed in `EnterpriseCapabilitiesSection.tsx` (its own
 * comment names the exact bug — "the solid recipe's contrast colour did not
 * reach the text in light mode and the button read as dark ink on orange" —
 * and states the fix, a hard-coded `color="white"`), so this is a real
 * regression guard against that colour drifting back, not a guess at
 * "readable". What is NOT honest, and is left out: asserting on axe or any
 * other tool's opinion of what counts as "accessible enough" — the actual
 * WCAG 4.5:1 ratio for normal-weight 14px text is the one number this button
 * has ever been wrong about, and it is the one this test checks.
 */
import { expect, test } from "@playwright/test";
import {
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenARegisteredAccount,
  givenMyAccountHasAWorkspace,
  whenISignInWithPassword,
} from "./steps";

test.use({ storageState: { cookies: [], origins: [] } });

/** WCAG relative luminance of an sRGB channel (0-255). */
function channelLuminance(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an `rgb(r, g, b)` / `rgba(r, g, b, a)` triple. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function parseRgb(css: string): [number, number, number] {
  const match = /rgba?\(([^)]+)\)/.exec(css);
  if (!match) throw new Error(`Not an rgb()/rgba() colour: ${css}`);
  const [r, g, b] = match[1].split(",").map((n) => parseFloat(n.trim()));
  return [r, g, b];
}

/** WCAG contrast ratio between two `rgb()` CSS colour strings. */
function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(parseRgb(a));
  const l2 = relativeLuminance(parseRgb(b));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe("Activate-a-license button contrast", () => {
  test("is readable against its orange fill in light mode", async ({ page }) => {
    const email = generateFrontDoorEmail("license-contrast");
    await givenARegisteredAccount(page, { email });

    // next-themes (`ColorModeProvider`, `attribute="class"`) reads its stored
    // preference from `localStorage["theme"]` before first paint. Setting it
    // via an init script — rather than clicking a theme toggle — forces light
    // mode deterministically regardless of the runner's OS-level preference.
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "light");
    });

    await whenISignInWithPassword(page, { email, password: FRONT_DOOR_PASSWORD });
    await givenMyAccountHasAWorkspace(page);
    await page.goto("/settings/security");

    const section = page.getByTestId("enterprise-capabilities");
    await expect(section).toBeVisible({ timeout: 15000 });
    // Scoped to the section: the sidebar carries its own "License" link to
    // the same address, and this is the button, not the navigation.
    const button = section.locator('a[href="/settings/license"]');
    await expect(button).toBeVisible();
    await expect(button).toHaveText("Activate a license");

    const { color, backgroundColor } = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, backgroundColor: style.backgroundColor };
    });

    const ratio = contrastRatio(color, backgroundColor);
    // WCAG AA for normal text (this button's label is 14px / `sm`, not the
    // 18px+/bold "large text" the 3:1 threshold applies to).
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
