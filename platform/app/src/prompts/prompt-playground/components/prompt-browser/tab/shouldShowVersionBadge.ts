/**
 * Pure logic for deciding whether a prompt tab shows its version number.
 *
 * Single Responsibility: Decide version-badge visibility from tab state alone.
 *
 * A version is worth showing in exactly two cases:
 *   - the tab is behind the latest saved version, or
 *   - the same prompt is open in more than one tab at differing versions, so
 *     the titles alone cannot tell those tabs apart.
 *
 * Otherwise the number is noise: it is the latest, and it is unambiguous.
 */
export const shouldShowVersionBadge = ({
  isOutdated,
  configId,
  allTabsData,
}: {
  isOutdated: boolean;
  configId: string | undefined;
  allTabsData: Array<{ configId?: string; versionNumber?: number }>;
}): boolean => {
  if (isOutdated) return true;

  // A prompt that was never saved has no version to be behind or ambiguous about.
  if (!configId) return false;

  const samePromptTabs = allTabsData.filter((t) => t.configId === configId);
  if (samePromptTabs.length <= 1) return false;

  const versions = new Set(samePromptTabs.map((t) => t.versionNumber));
  return versions.size > 1;
};
