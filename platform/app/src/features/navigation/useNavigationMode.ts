import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type NavigationMode,
  useNavigationModeStore,
} from "./navigationModeStore";

export type NavigationModeResolution =
  | { status: "ready"; mode: NavigationMode }
  | { status: "loading" };

/**
 * Resolve which navigation shell this device renders, without flicker in
 * either direction:
 *
 * - Stored mode `legacy` (the default, including garbage in storage)
 *   resolves synchronously. The flag query never runs, so the current
 *   chrome renders with zero extra requests, the fast path every
 *   flag-off customer takes.
 * - A stored v2 mode stays `loading` until the organization and the
 *   release_ui_navigation_v2_enabled flag resolve, so the old chrome
 *   never flashes before the new shell. Flag off resolves to `legacy`
 *   without erasing the stored preference.
 *
 * Layout seams key off `mode !== "legacy"`, never off the raw flag.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
export function useNavigationMode(): NavigationModeResolution {
  const storedMode = useNavigationModeStore((state) => state.storedMode);
  const isV2Requested = storedMode !== "legacy";

  // The same organization queries the dashboard layout itself runs; react-query
  // dedupes them, so the legacy path stays at zero extra requests.
  const { organization, isLoading: isOrganizationLoading } =
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    });

  const { enabled: flagEnabled, isLoading: isFlagLoading } = useFeatureFlag(
    "release_ui_navigation_v2_enabled",
    {
      organizationId: organization?.id,
      // Only a device that opted into a v2 mode pays for the flag check, and
      // only once the organization is known (an org-less user still resolves
      // user-level).
      enabled: isV2Requested && !isOrganizationLoading,
    },
  );

  if (!isV2Requested) return { status: "ready", mode: "legacy" };
  if (isOrganizationLoading || isFlagLoading) return { status: "loading" };
  return { status: "ready", mode: flagEnabled ? storedMode : "legacy" };
}
