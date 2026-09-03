/**
 * Whether a project is the deployment's shared demo project. Requires
 * both sides present — an unconfigured demo slug and an unresolved
 * project slug must not read as a match for a project that hasn't loaded.
 */
export function isLangyDemoProject({
  projectSlug,
  demoProjectSlug,
}: {
  projectSlug: string | undefined;
  demoProjectSlug: string | undefined;
}): boolean {
  return !!demoProjectSlug && demoProjectSlug === projectSlug;
}
