import { Banner } from "@langwatch/design-system/banner";

/** Shown over the create drawer once the legacy key is revoked, until its replacement exists. */
export function LegacyKeyRevokedNotice() {
  return (
    <Banner
      status="warning"
      title="The legacy project key no longer works"
      data-testid="legacy-key-revoked-notice"
    >
      Create this key and put it wherever the legacy key was used. If you close this drawer, this
      project may have no working key until you create one.
    </Banner>
  );
}
