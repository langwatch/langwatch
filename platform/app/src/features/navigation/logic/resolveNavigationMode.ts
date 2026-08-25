import { DEFAULT_NAVIGATION_MODE, type NavigationMode } from "../navigationModeStore";

export type NavigationModeResolution =
  | { status: "ready"; mode: NavigationMode }
  | { status: "loading" };

export type NavigationFlagAnswer =
  | { status: "pending" }
  | { status: "answered"; isEnabled: boolean };

export interface NavigationModeInputs {
  /** The mode the reader picked, null when they never picked one. */
  storedMode: NavigationMode | null;
  /** The last release_ui_navigation_v2_enabled answer on this device. */
  isLastKnownFlagEnabled: boolean | null;
  flag: NavigationFlagAnswer;
}

/**
 * Which navigation shell to render, resolved in three steps so no reader
 * waits for an answer that cannot change what they see:
 *
 * 1. A picked `legacy` is an opt-out and never consults the flag. It
 *    resolves on the first frame with no extra request.
 * 2. With the flag answered, the flag decides: off is legacy, on is the
 *    picked mode, or the default mode when there is no pick.
 * 3. While the flag is pending, a picked v2 mode waits, so the old
 *    chrome never flashes in front of it. A device with no pick paints
 *    the answer the flag last gave it here, so it never waits either:
 *    legacy until the flag has answered on at least once.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
export function resolveNavigationMode({
  storedMode,
  isLastKnownFlagEnabled,
  flag,
}: NavigationModeInputs): NavigationModeResolution {
  if (storedMode === "legacy") return { status: "ready", mode: "legacy" };

  if (flag.status === "answered") {
    if (!flag.isEnabled) return { status: "ready", mode: "legacy" };
    return { status: "ready", mode: storedMode ?? DEFAULT_NAVIGATION_MODE };
  }

  if (storedMode !== null) return { status: "loading" };

  return {
    status: "ready",
    mode: isLastKnownFlagEnabled ? DEFAULT_NAVIGATION_MODE : "legacy",
  };
}

/**
 * Whether this device paints the legacy chrome before the flag answers.
 * For the few call sites that read the mode outside a render, where
 * subscribing to the flag query is not possible.
 */
export function isLegacyNavigationDevice({
  storedMode,
  isLastKnownFlagEnabled,
}: Pick<NavigationModeInputs, "storedMode" | "isLastKnownFlagEnabled">): boolean {
  const resolution = resolveNavigationMode({
    storedMode,
    isLastKnownFlagEnabled,
    flag: { status: "pending" },
  });
  return resolution.status === "ready" && resolution.mode === "legacy";
}
