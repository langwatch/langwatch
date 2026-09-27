/** Whether any of a project's model providers is switched on. */
export function hasEnabledModelProvider(
  providers: Readonly<Record<string, { enabled: boolean }>>,
): boolean {
  return Object.values(providers).some((provider) => provider.enabled);
}
