const PUBLIC_KEY_OVERRIDE_VARIABLE = "LANGWATCH_LICENSE_PUBLIC_KEY";

/**
 * Release builds verify licences against the embedded LangWatch key only; dev and test builds
 * honour the override. `publicKey` undefined means the embedded key; `ignoredVariable` names
 * an override a release build set aside, never its value.
 */
export function licenseVerifyingKeyOf({
  override,
  isReleaseBuild,
}: {
  override: string | undefined;
  isReleaseBuild: boolean;
}): { publicKey: string | undefined; ignoredVariable: string | undefined } {
  if (!isReleaseBuild) return { publicKey: override, ignoredVariable: undefined };
  return {
    publicKey: undefined,
    ignoredVariable: override === undefined ? undefined : PUBLIC_KEY_OVERRIDE_VARIABLE,
  };
}
