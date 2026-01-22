const INTERNAL_SET_PREFIX = "__internal__";
const ON_PLATFORM_SET_SUFFIX = "__on-platform-scenarios";

export function isInternalSetId(setId: string): boolean {
  return setId.startsWith(INTERNAL_SET_PREFIX);
}

export function isOnPlatformSet(setId: string): boolean {
  return setId.startsWith(INTERNAL_SET_PREFIX) && setId.endsWith(ON_PLATFORM_SET_SUFFIX);
}

export function getOnPlatformSetId(projectId: string): string {
  return `${INTERNAL_SET_PREFIX}${projectId}${ON_PLATFORM_SET_SUFFIX}`;
}

export function getDisplayName(setId: string): string {
  if (isOnPlatformSet(setId)) {
    return "On-Platform Scenarios";
  }
  return setId;
}
