import { Banner, BannerAction } from "@langwatch/design-system/banner";

/**
 * Tells an admin which projects still hold a live legacy key. The screen is
 * organisation-wide, so one project's revoke leaves the others named here.
 * The one-click action only stands for a single project; several revoke by row.
 */
export function LegacyProjectKeyBanner({
  projectNames,
  onRevoke,
}: {
  projectNames: readonly string[];
  onRevoke: (() => void) | undefined;
}) {
  return (
    <Banner
      status="warning"
      title="Legacy project keys are going away"
      action={onRevoke && <BannerAction onClick={onRevoke}>Revoke and replace</BannerAction>}
      data-testid="legacy-project-key-banner"
    >
      {projectNames.length > 1
        ? `Use personal access tokens instead. Still live in ${projectNames.join(", ")}.`
        : "Use personal access tokens instead."}
    </Banner>
  );
}
