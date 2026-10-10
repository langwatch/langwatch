import { showErrorToast } from "@langwatch/browser-host/errors";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { useState } from "react";

/** Who last wrote the newer version, named by the actor the server reported. */
const WHO_UPDATED_IT: Record<string, string> = {
  langy: "Langy updated this evaluation",
  api: "This evaluation was updated through the API",
};

/**
 * Shown when the server holds a newer version of this workbench and the user has
 * unsaved edits.
 */
export function WorkbenchStaleBanner({
  actorLabel,
  onReload,
}: {
  actorLabel?: string;
  onReload: () => Promise<void>;
}) {
  const [isReloading, setIsReloading] = useState(false);

  const who = WHO_UPDATED_IT[actorLabel ?? ""] ?? "This evaluation was updated somewhere else";

  return (
    <Banner
      status="warning"
      placement="top"
      data-testid="workbench-stale-banner"
      action={
        <BannerAction
          loading={isReloading}
          onClick={() => {
            setIsReloading(true);
            void onReload()
              .catch((error) => {
                // The user pressed Reload, so a failure has to reach them. Their
                // unsaved edits are still here and the banner stays up, so the
                // button is worth pressing again.
                showErrorToast({
                  error,
                  fallbackTitle: "Couldn't reload this evaluation",
                });
              })
              .finally(() => setIsReloading(false));
          }}
        >
          Reload
        </BannerAction>
      }
    >
      {who}. Reloading shows the latest version and discards your unsaved edits.
    </Banner>
  );
}
