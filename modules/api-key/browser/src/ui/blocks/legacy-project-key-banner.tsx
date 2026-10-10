import { Banner } from "@langwatch/design-system/banner";

/** Tells an admin that the project's legacy key is on its way out. */
export function LegacyProjectKeyBanner() {
  return (
    <Banner
      status="warning"
      title="Legacy project keys are going away"
      data-testid="legacy-project-key-banner"
    >
      Use personal access tokens instead.
    </Banner>
  );
}
