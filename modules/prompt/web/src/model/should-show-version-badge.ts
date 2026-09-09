export function shouldShowVersionBadge({
  isOutdated,
  configId,
  allTabsData,
}: {
  isOutdated: boolean;
  configId: string | undefined;
  allTabsData: Array<{ configId?: string; versionNumber?: number }>;
}): boolean {
  if (isOutdated) {
    return true;
  }

  if (!configId) {
    return false;
  }

  const samePromptTabs = allTabsData.filter((tab) => tab.configId === configId);

  if (samePromptTabs.length <= 1) {
    return false;
  }

  const versions = new Set(samePromptTabs.map((tab) => tab.versionNumber));
  return versions.size > 1;
}
