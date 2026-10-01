import { useUiCapabilities } from "@langwatch/browser-host/capabilities";

import { hardRedirect } from "../../../behavior/hard-redirect.ts";
import { adminClient } from "../../../features/admin/behavior/admin-client.ts";
import { ImpersonationBanner, type ImpersonationBannerProps } from "./impersonation-banner.tsx";

/** Where Stop lands the operator: the back office's user list, main's `/admin#/user`. */
export const ADMIN_PANEL_PATH = "/ops/users";

/** The banner ops lends to the shell header; Stop ends the impersonation itself. */
export function ImpersonationHeaderBanner({ user }: Pick<ImpersonationBannerProps, "user">) {
  const { feedback } = useUiCapabilities();
  const stop = async () => {
    try {
      await adminClient.stopImpersonation();
    } catch (error) {
      feedback.failed({ error, fallbackTitle: "Couldn't stop impersonating" });
      return;
    }
    // A page load, not a navigation: no cached read may keep the impersonated identity.
    hardRedirect(ADMIN_PANEL_PATH);
  };
  return <ImpersonationBanner user={user} onStop={() => void stop()} />;
}
