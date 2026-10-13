const PUBLIC_KEY_OVERRIDE_VARIABLE = "LANGWATCH_LICENSE_PUBLIC_KEY";

/**
 * Release builds verify with the embedded LangWatch key and refuse a `devStack` licence whatever
 * signed it; dev builds honour the override. `publicKey` undefined means the embedded key;
 * `ignoredVariable` names an override a release build set aside, never its value.
 */
export function licenseVerifyingKeyOf({
  override,
  isReleaseBuild,
}: {
  override: string | undefined;
  isReleaseBuild: boolean;
}): {
  publicKey: string | undefined;
  ignoredVariable: string | undefined;
  refuseDevStack: boolean;
} {
  if (!isReleaseBuild) {
    return { publicKey: override, ignoredVariable: undefined, refuseDevStack: false };
  }
  return {
    publicKey: undefined,
    ignoredVariable: override === undefined ? undefined : PUBLIC_KEY_OVERRIDE_VARIABLE,
    refuseDevStack: true,
  };
}
