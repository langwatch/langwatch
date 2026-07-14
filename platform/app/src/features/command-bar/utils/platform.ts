/**
 * Platform detection utilities for the command bar.
 */

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    platform?: string;
  };
}

/**
 * Detects if the current platform is macOS.
 * Uses modern userAgentData API with fallback to deprecated navigator.platform.
 */
export function getIsMac(): boolean {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as NavigatorWithUserAgentData;

  // Modern API (Navigator.userAgentData)
  if (nav.userAgentData?.platform) {
    return nav.userAgentData.platform.toLowerCase().includes("mac");
  }

  // Fallback for older browsers (deprecated but widely supported)
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return navigator.platform?.toUpperCase().includes("MAC") ?? false;
}

/**
 * Returns the appropriate modifier key display text for the current platform.
 */
export function getModifierKeyDisplay(): string {
  return getIsMac() ? "⌘" : "Ctrl";
}

/**
 * Returns the keyboard shortcut display text for the command bar.
 */
export function getCommandBarShortcut(): string {
  return getIsMac() ? "⌘K" : "Ctrl+K";
}
