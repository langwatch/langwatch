
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

import { StartupNoticeBanner } from "./StartupNoticeBanner";

/**
 * The one-time notice that this install reports usage
 * (specs/self-hosting/checkup/startup-notice.feature).
 *
 * Shown to administrators of a self-hosted install once per schema version
 * of the report, in the app rather than in a boot log, and dismissed into
 * the install's own database so it stays dismissed for every administrator
 * and every browser.
 */
export function StartupNotice() {
  const publicEnv = usePublicEnv();
  const { organization, hasPermission } = useOrganizationTeamProject();
  const isSelfHosted = publicEnv.data?.IS_SAAS === false;
  const canManage = hasPermission("organization:manage");
  const organizationId = organization?.id ?? "";

  const notice = api.checkup.startupNotice.useQuery(
    { organizationId },
    {
      enabled: isSelfHosted && canManage && organizationId !== "",
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  );

  if (!isSelfHosted || !canManage || !notice.data?.show) return null;

  return (
    <StartupNoticeBanner
      organizationId={organizationId}
      schemaVersion={notice.data.schemaVersion}
    />
  );
}
