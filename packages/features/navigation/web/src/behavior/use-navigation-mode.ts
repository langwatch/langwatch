import { useEffect } from "react";
import { useNavigationHost } from "../model/navigation-host";
import {
  type NavigationModeResolution,
  resolveNavigationMode,
} from "../model/resolve-navigation-mode";
import { useNavigationModeStore } from "./navigation-mode.store";

export type { NavigationModeResolution };

/**
 * Resolve which navigation shell this device renders, without flicker in
 * either direction:
 *
 * - A picked `legacy` resolves synchronously. The flag query never runs,
 *   so the current chrome renders with zero extra requests, the fast
 *   path every reader who opted out takes.
 * - A picked v2 mode stays `loading` until the organization and the
 *   release_ui_navigation_v2_enabled flag resolve, so the old chrome
 *   never flashes before the new shell. Flag off resolves to `legacy`
 *   without erasing the stored preference.
 * - A device with no pick never waits: it paints the answer the flag
 *   last gave it, then follows the flag. That is legacy on a device the
 *   flag has never been on for, so a flag-off reader sees the current
 *   chrome on the first frame and it never changes under them.
 *
 * The flag query shares its key with the one the avatar menu already
 * runs on every page, so react-query answers both with one request.
 *
 * Layout seams key off `mode !== "legacy"`, never off the raw flag.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
export function useNavigationMode(): NavigationModeResolution {
  const storedMode = useNavigationModeStore((state) => state.storedMode);
  const isLastKnownFlagEnabled = useNavigationModeStore((state) => state.isLastKnownFlagEnabled);
  const rememberFlag = useNavigationModeStore((state) => state.rememberFlag);
  const isFlagNeeded = storedMode !== "legacy";

  // The same workspace read the chrome itself runs; the host answers both from
  // one query, so the opted-out path stays at zero extra requests.
  const host = useNavigationHost();
  const isOrganizationLoading = host.isLoading();

  // A reader who opted out of the new navigation pays for no flag check at all,
  // and the check waits until the organization is known (an org-less user still
  // resolves user-level). The platform hook expressed both by passing
  // `enabled:` down to the flag QUERY; the host answers flags now, so the same
  // two properties are "do not ask".
  const isFlagAsked = isFlagNeeded && !isOrganizationLoading;
  const flag = isFlagAsked
    ? host.featureFlag("release_ui_navigation_v2_enabled")
    : { enabled: false, isLoading: false };
  const isFlagEnabled = flag.enabled;
  const isFlagLoading = flag.isLoading;

  const isFlagAnswered = isFlagAsked && !isFlagLoading;

  // Remembering the answer is what lets the next visit paint the right
  // shell on its first frame instead of starting on the other one.
  useEffect(() => {
    if (isFlagAnswered) rememberFlag(isFlagEnabled);
  }, [isFlagAnswered, isFlagEnabled, rememberFlag]);

  return resolveNavigationMode({
    storedMode,
    isLastKnownFlagEnabled,
    flag: isFlagAnswered ? { status: "answered", isEnabled: isFlagEnabled } : { status: "pending" },
  });
}
