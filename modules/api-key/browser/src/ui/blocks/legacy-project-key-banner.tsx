import { Banner, BannerAction } from "@langwatch/design-system/banner";

/**
 * Names the projects that still hold a live legacy key. The screen is
 * organisation-wide, so revoking one leaves the others named here. The one-click
 * action stands for a single project only; several revoke by row.
 */
export function LegacyProjectKeyBanner<Key extends Readonly<{ projectName: string }>>({
  keys,
  onRevoke,
}: {
  keys: readonly Key[];
  onRevoke: (key: Key) => void;
}) {
  if (keys.length === 0) return null;
  const only = keys.length === 1 ? keys[0] : undefined;
  const names = keys.map((key) => key.projectName).join(", ");

  return (
    <Banner
      status="warning"
      title="Legacy project keys are going away"
      action={
        only && <BannerAction onClick={() => onRevoke(only)}>Revoke and replace</BannerAction>
      }
      data-testid="legacy-project-key-banner"
    >
      {only
        ? "Use personal access tokens instead."
        : `Use personal access tokens instead. Still live in ${names}.`}
    </Banner>
  );
}
